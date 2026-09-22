"""Transcript cleanup: extract text, chunk it, stream each chunk through Gemini, yield events."""
import asyncio
import logging
import html
import io
import json
import re
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import errors, types

from prompts import build_brief, build_brief_system, build_system, build_user

# The SDK warns about automatic function calling on every streaming call; we pass no tools.
logging.getLogger("google_genai.models").setLevel(logging.ERROR)

# Verified against the live models.list() for this key on 2026-09-21.
# Swap for "gemini-3.1-pro-preview" or "gemini-2.5-pro" if flash drops detail on hard transcripts.
MODEL = "gemini-3.8-flash"
# Gemini thinks by default and thinking counts against max_output_tokens, so leave headroom
# above the expected output.
MAX_TOKENS = 32000
BRIEF_MAX_TOKENS = 16000  # the action-items pass; one call over the whole cleaned transcript

# Thinking is by far the largest cost here. Measured on a 2,491-word transcript (2026-09-21):
#   default (HIGH)  10,442 thinking + 3,105 content = 13,547 out,  55 flags
#   MEDIUM          10,020 thinking + 2,853 content = 12,873 out,  20 flags
#   LOW                  0 thinking + 2,851 content =  2,851 out,  13 flags
# LOW is 79% cheaper than default with no loss of correction quality - it still caught
# "a video" -> Nvidia and "4 to 6" -> TRL 4-6, and preserved *more* paragraph structure
# (46 vs 40). HIGH mostly buys over-flagging. Raise to "MEDIUM"/"HIGH" if a transcript is so
# garbled that LOW misses real errors. Note gemini-3.x ignores thinking_budget; use the level.
THINKING_LEVEL = "LOW"   # None = model default (expensive); "LOW" | "MEDIUM" | "HIGH"
TEMPERATURE = 0          # Gemini accepts this (Sonnet 5 did not), so runs are near-deterministic
CHUNK_WORDS = 3000       # target words per chunk
CONTEXT_TURNS = 2        # last N turns of the previous cleaned chunk are passed as context
CONTEXT_WORDS = 300      # a longer turn is cut into lines/sentences before taking the tail
RETRIES = 2              # retries per chunk after the first attempt
RUNS_DIR = Path(__file__).parent / "runs"
EXTENSIONS = {".txt", ".md", ".vtt", ".srt", ".docx"}

# ---------------------------------------------------------------- extraction


def _decode(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


_CUE = re.compile(r"(\d[\d:.,]*)\s*-->\s*(\d[\d:.,]*)")
_VOICE = re.compile(r"<v(?:\.\S+)?\s+([^>]+)>")  # WebVTT <v Speaker>
_TAG = re.compile(r"</?[A-Za-z][^>]*>|<\d+:\d+[^>]*>")


def _cues(text: str) -> str:
    """VTT/SRT to one '[start --> end] text' paragraph per cue, so timestamps stay with their text."""
    out = []
    for block in re.split(r"\n\s*\n", text):
        lines = block.strip().split("\n")
        for n, line in enumerate(lines):
            if m := _CUE.search(line):
                break
        else:
            continue  # WEBVTT header, NOTE/STYLE block
        body = " ".join(s.strip() for s in lines[n + 1:] if s.strip())
        body = html.unescape(_TAG.sub("", _VOICE.sub(r"\1: ", body))).strip()
        if body:
            out.append(f"[{m[1]} --> {m[2]}] {body}")
    return "\n\n".join(out)


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            root = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        raise ValueError("Couldn't read that .docx file.") from None
    paras = []
    for p in root.iter(_W + "p"):
        parts = []
        for el in p.iter():
            if el.tag == _W + "t":
                parts.append(el.text or "")
            elif el.tag == _W + "tab":
                parts.append("\t")
            elif el.tag in (_W + "br", _W + "cr"):
                parts.append("\n")
        paras.append("".join(parts).strip())
    return "\n\n".join(p for p in paras if p)


def extract_text(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in EXTENSIONS:
        raise ValueError(f"Unsupported file type '{ext}'. Use .txt, .md, .vtt, .srt or .docx.")
    if ext == ".docx":
        return _docx(data)
    text = _decode(data).replace("\r\n", "\n").replace("\r", "\n")
    return _cues(text) if ext in (".vtt", ".srt") else text


# ------------------------------------------------------------------ chunking

# Each unit keeps its trailing whitespace, so "".join(units) == text exactly.
_PARA = re.compile(r"(?s).+?(?:\n[ \t]*\n\s*|\Z)")
_LINE = re.compile(r"(?s).+?(?:\n\s*|\Z)")
# ponytail: naive sentence split (abbreviations like "Dr. Smith" can split early); only used
# for a single line longer than a whole chunk. Swap in a real sentence tokenizer if that bites.
_SENT = re.compile(r"(?s).+?(?:[.!?][\"')\]]*\s+|\Z)")


def _words(s: str) -> int:
    return len(s.split())


def _units(text: str, limit: int) -> list[str]:
    """Turns: blank-line paragraphs. One over `limit` words falls back to lines, then sentences."""
    out = []
    for para in _PARA.findall(text):
        if _words(para) <= limit:
            out.append(para)
            continue
        for line in _LINE.findall(para):
            out.extend([line] if _words(line) <= limit else _SENT.findall(line))
    return out


def chunk(text: str, target: int = CHUNK_WORDS) -> list[str]:
    """Split on turn boundaries into ~`target`-word chunks. "".join(chunk(t)) == t."""
    chunks, cur, n = [], [], 0
    for unit in _units(text, target):
        w = _words(unit)
        if cur and n + w > target:
            chunks.append("".join(cur))
            cur, n = [], 0
        cur.append(unit)
        n += w
    if cur:
        chunks.append("".join(cur))
    return chunks


# ------------------------------------------------------------------ pipeline

_TAGS = re.compile(r"^\s*<transcript>\s*|\s*</transcript>\s*$")


def _fatal(e: Exception) -> bool:
    """Bad key, model, params or billing: no retry fixes these, so the whole run stops."""
    # 429 is deliberately absent: rate limits are retryable.
    return isinstance(e, errors.ClientError) and e.code in (400, 401, 402, 403, 404, 413)


def _why(e: Exception) -> str:
    """The API's own error message when there is one (str(e) on an APIError is a raw JSON dump)."""
    msg = getattr(e, "message", None)
    return msg if isinstance(msg, str) and msg else str(e)


def _tail(cleaned: str) -> str:
    """Last CONTEXT_TURNS turns of the previous cleaned chunk, for name/terminology consistency."""
    return "".join(_units(cleaned, CONTEXT_WORDS)[-CONTEXT_TURNS:]).strip()


async def clean(text: str, glossary: str = "", filename: str = ""):
    """Async generator of progress events (dicts) for one run; the web layer forwards them as SSE."""
    system = build_system(glossary)
    chunks = chunk(text)
    yield {"type": "start", "chunks": chunks, "model": MODEL}

    # Reads GEMINI_API_KEY from the environment; app.py has already checked it is set.
    client = genai.Client()  # retries are handled per chunk below
    t0 = time.monotonic()
    outs, failed, usage = [], [], {"input": 0, "output": 0}

    run_dir = None

    def save() -> str:
        nonlocal run_dir
        if run_dir is None:  # first call fixes the name; later calls rewrite the same directory
            stem = re.sub(r"[^\w.-]+", "_", Path(filename).stem)[:40] or "pasted"
            run_dir = RUNS_DIR / f"{datetime.now():%Y%m%d-%H%M%S}-{stem}"
        d = run_dir
        d.mkdir(parents=True, exist_ok=True)
        (d / "input.txt").write_text(text, encoding="utf-8")
        (d / "output.txt").write_text("".join(outs), encoding="utf-8")
        (d / "system_prompt.txt").write_text(system, encoding="utf-8")
        meta = {
            "timestamp": datetime.now().astimezone().isoformat(timespec="seconds"),
            "model": MODEL,
            "filename": filename,
            "chunks": len(chunks),
            "chunks_done": len(outs),
            "failed_chunks": failed,
            "tokens": usage,
            "elapsed_s": round(time.monotonic() - t0, 1),
        }
        (d / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return d.name

    saved = None
    try:
        for n, body in enumerate(chunks, 1):
            yield {"type": "chunk_start", "n": n}
            user = build_user(body.strip(), _tail(outs[-1]) if outs else "")
            result, error = None, ""
            for attempt in range(RETRIES + 1):
                try:
                    result = ""
                    stream = await client.aio.models.generate_content_stream(
                        model=MODEL,
                        contents=user,
                        config=types.GenerateContentConfig(
                            system_instruction=system,
                            max_output_tokens=MAX_TOKENS,
                            temperature=TEMPERATURE,
                            thinking_config=None if THINKING_LEVEL is None
                            else types.ThinkingConfig(thinking_level=THINKING_LEVEL),
                        ),
                    )
                    # Only the final parts carry finish_reason and the cumulative usage; keep the
                    # last of each rather than assuming they land on the very last part.
                    done, used = None, None
                    async for part in stream:
                        if part.text:
                            result += part.text
                            yield {"type": "delta", "n": n, "text": part.text}
                        if part.candidates and part.candidates[0].finish_reason:
                            done = part.candidates[0].finish_reason
                        if part.usage_metadata:
                            used = part.usage_metadata
                    if done != types.FinishReason.STOP:
                        raise ValueError(f"stopped early ({done})")
                    result = _TAGS.sub("", result).strip()
                    # ponytail: naive length check; catches truncation/summarising, not subtle edits
                    if _words(body) > 30 and _words(result) < 0.6 * _words(body):
                        raise ValueError("output is much shorter than the input")
                    if used:
                        usage["input"] += used.prompt_token_count or 0
                        # Thinking is billed as output, so fold it in rather than under-reporting.
                        usage["output"] += ((used.candidates_token_count or 0)
                                            + (used.thoughts_token_count or 0))
                    break
                except Exception as e:
                    result = None
                    error = _why(e)
                    if _fatal(e):
                        yield {"type": "error", "message": f"{e.code}: {error}"}
                        return
                    if attempt < RETRIES:
                        yield {"type": "retry", "n": n, "attempt": attempt + 2, "of": RETRIES + 1, "error": error}
                        await asyncio.sleep(3 * 2 ** attempt)

            ok = result is not None
            sep = body[len(body.rstrip()):]  # original whitespace between chunks (only the last has none)
            piece = (result if ok else f"[CHUNK FAILED]\n\n{body.strip()}") + sep
            if not ok:
                failed.append(n)
            outs.append(piece)
            yield {"type": "chunk_end", "n": n, "ok": ok, "text": piece,
                   "error": "" if ok else error, "tokens": dict(usage)}

        saved = save()
        # The action-items pass is its own request (agent.propose via POST /agent) so it can be
        # retried, or re-run after editing the glossary, without cleaning the transcript again.
        yield {"type": "done", "elapsed": round(time.monotonic() - t0, 1), "tokens": dict(usage),
               "failed": failed, "run": saved}
    finally:
        if saved is None and outs:
            save()  # stopped or aborted partway: keep what finished


# ------------------------------------------------------------- action items


async def brief(cleaned: str, glossary: str = "", out_dir: Path | None = None):
    """One pass over an already-cleaned transcript. Yields brief_* events; never raises.

    Kept separate from clean() so the UI can regenerate action items without cleaning again.
    """
    yield {"type": "brief_start"}
    if not cleaned.strip():
        yield {"type": "brief_error", "message": "Nothing to summarise."}
        return

    system, user = build_brief_system(glossary), build_brief(cleaned)
    client = genai.Client()
    text, usage = "", {"input": 0, "output": 0}

    for attempt in range(RETRIES + 1):
        try:
            text = ""
            stream = await client.aio.models.generate_content_stream(
                model=MODEL,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=BRIEF_MAX_TOKENS,
                    temperature=TEMPERATURE,
                    thinking_config=None if THINKING_LEVEL is None
                    else types.ThinkingConfig(thinking_level=THINKING_LEVEL),
                ),
            )
            done, used = None, None
            async for part in stream:
                if part.text:
                    text += part.text
                    yield {"type": "brief_delta", "text": part.text}
                if part.candidates and part.candidates[0].finish_reason:
                    done = part.candidates[0].finish_reason
                if part.usage_metadata:
                    used = part.usage_metadata
            if done != types.FinishReason.STOP:
                raise ValueError(f"stopped early ({done})")
            if not text.strip():
                raise ValueError("empty response")
            if used:
                usage["input"] = used.prompt_token_count or 0
                usage["output"] = ((used.candidates_token_count or 0)
                                   + (used.thoughts_token_count or 0))
            break
        except Exception as e:
            why = _why(e)
            if _fatal(e) or attempt == RETRIES:
                # The cleaned transcript is already saved and on screen, so a failure here
                # is reported and skipped rather than failing the whole run.
                yield {"type": "brief_error", "message": why}
                return
            # Deltas for the failed attempt were already sent; the UI clears on retry.
            yield {"type": "brief_retry", "attempt": attempt + 2, "of": RETRIES + 1, "error": why}
            await asyncio.sleep(3 * 2 ** attempt)

    text = text.strip()
    if out_dir:
        (out_dir / "actions.md").write_text(text, encoding="utf-8")
    yield {"type": "brief_end", "text": text, "tokens": usage}
