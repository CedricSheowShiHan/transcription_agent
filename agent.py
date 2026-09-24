"""Agentic action-items pass: the model drives via tool calls instead of writing Markdown.

The difference from `cleaner.brief` is who decides. `brief` asks for a document in one shot.
Here the model is given tools and chooses how many items exist, what to call each one, and when
it is finished; the loop below just executes what it asks for and feeds the results back.

Nothing here touches an external system. Tool calls only append to in-memory lists, and the
result reaches disk when - and only when - the operator approves it and app.py calls `commit`.
"""
import json
import re
from datetime import datetime
from pathlib import Path
from google import genai
from google.genai import types

# Shared config and error helpers, so the agent and the cleaner behave the same way on failure.
from cleaner import MODEL, RUNS_DIR, TEMPERATURE, THINKING_LEVEL
from gemini_loop import run_turns
from prompts import build_agent_system, build_agent_user

MAX_TURNS = 8          # hard stop: the loop is model-driven, so it needs a ceiling it cannot raise
AGENT_MAX_TOKENS = 16000
MAX_ITEMS = 60         # a transcript with more than this is a sign something has gone wrong

_ITEM = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "The action as a short imperative phrase."},
        "owner": {"type": "string", "description": "Named person if the transcript identifies "
                                                   "one, otherwise the side or organisation."},
        "detail": {"type": "string", "description": "Context needed to act on it: who asked, "
                                                    "what it depends on, any caveat."},
        "due": {"type": "string", "description": "Deadline exactly as spoken, e.g. 'end of the "
                                                 "week'. Empty string if none was stated."},
        "blocking": {"type": "boolean", "description": "True only if other items wait on this."},
        "source_quote": {"type": "string", "description": "Short verbatim span from the "
                                                          "transcript supporting this item."},
    },
    "required": ["title", "owner", "detail"],
}
_QUESTION = {
    "type": "object",
    "properties": {
        "question": {"type": "string", "description": "The unresolved question."},
        "raised_by": {"type": "string", "description": "Who raised it, if the transcript says."},
        "why_open": {"type": "string", "description": "Unanswered on the call, contradicted "
                                                      "elsewhere, or agreed with no owner."},
    },
    "required": ["question"],
}
_SUMMARY = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "Two to four sentences: what the meeting "
                                                     "was about and what was decided."},
    },
    "required": ["summary"],
}

TOOLS = types.Tool(function_declarations=[
    types.FunctionDeclaration(name="set_summary", parameters_json_schema=_SUMMARY,
                              description="Record the meeting summary. Call exactly once."),
    types.FunctionDeclaration(name="add_action_item", parameters_json_schema=_ITEM,
                              description="Record one concrete action somebody committed to or "
                                          "was asked to do."),
    types.FunctionDeclaration(name="add_open_question", parameters_json_schema=_QUESTION,
                              description="Record one question left unanswered, contradicted, or "
                                          "agreed with no clear owner."),
])


def _clean(v, default=""):
    return v.strip() if isinstance(v, str) else default


def _stop(s: str) -> str:
    """End a sentence without doubling punctuation ('partnership?' must not become 'partnership?.')."""
    s = s.strip()
    return s if not s or s[-1] in ".?!:;" else s + "."


async def propose(cleaned: str, glossary: str = ""):
    """Async generator of agent events. Yields every tool call so the UI can show the work.

    Never raises: a failure is reported as `agent_error` and the cleaned transcript is untouched.
    """
    yield {"type": "agent_start"}
    if not cleaned.strip():
        yield {"type": "agent_error", "message": "Nothing to analyse."}
        return

    client = genai.Client()
    config = types.GenerateContentConfig(
        tools=[TOOLS],
        system_instruction=build_agent_system(glossary),
        max_output_tokens=AGENT_MAX_TOKENS,
        temperature=TEMPERATURE,
        thinking_config=None if THINKING_LEVEL is None
        else types.ThinkingConfig(thinking_level=THINKING_LEVEL),
        # We run the loop ourselves so each call can be streamed to the UI and capped.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    contents = [types.Content(role="user",
                              parts=[types.Part(text=build_agent_user(cleaned))])]
    summary, items, questions = "", [], []
    usage = {"input": 0, "output": 0}

    def record(name: str, args: dict) -> str:
        """Apply one tool call. Returns the status string handed back to the model."""
        nonlocal summary
        if name == "set_summary":
            summary = _clean(args.get("summary"))
            return "summary recorded"
        if name == "add_action_item":
            if len(items) >= MAX_ITEMS:
                return "limit reached; stop adding items"
            items.append({
                "title": _clean(args.get("title")),
                "owner": _clean(args.get("owner"), "Unassigned"),
                "detail": _clean(args.get("detail")),
                "due": _clean(args.get("due")),
                "blocking": bool(args.get("blocking")),
                "source_quote": _clean(args.get("source_quote")),
            })
            return f"action item {len(items)} recorded"
        if name == "add_open_question":
            if len(questions) >= MAX_ITEMS:
                return "limit reached; stop adding questions"
            questions.append({
                "question": _clean(args.get("question")),
                "raised_by": _clean(args.get("raised_by")),
                "why_open": _clean(args.get("why_open")),
            })
            return f"open question {len(questions)} recorded"
        return f"unknown tool {name}"

    async for ev in run_turns(client, contents, config, record, usage,
                              prefix="agent", max_turns=MAX_TURNS):
        yield ev
        if ev["type"] == "agent_error":
            return

    # Blocking items first, then the order the model recorded them in.
    items.sort(key=lambda x: not x["blocking"])
    yield {"type": "agent_end", "summary": summary, "items": items, "questions": questions,
           "tokens": usage}


# ------------------------------------------------------------------- commit

_SAFE_RUN = re.compile(r"^[\w.-]+$")


def _run_dir(run: str) -> Path:
    """Resolve a run name to its directory, refusing anything that escapes RUNS_DIR."""
    if not run or not _SAFE_RUN.match(run):
        raise ValueError("Invalid run name.")
    d = (RUNS_DIR / run).resolve()
    if d.parent != RUNS_DIR.resolve() or not d.is_dir():
        raise ValueError("No such run.")
    return d


def _markdown(summary: str, items: list, questions: list) -> str:
    out = ["# Action items", ""]
    if summary:
        out += ["## Summary", "", summary, ""]
    if items:
        out += ["## Action items", ""]
        for owner in dict.fromkeys(i["owner"] for i in items):  # keep first-seen owner order
            out += [f"### {owner}", ""]
            for i in (x for x in items if x["owner"] == owner):
                bits = [_stop(i["title"])]
                if i["detail"]:
                    bits.append(_stop(i["detail"]))
                if i["due"]:
                    bits.append(f"Due: {i['due']}.")
                if i["blocking"]:
                    bits.append("**Blocks the other items.**")
                out.append(f"- [ ] {' '.join(bits)}")
                if i["source_quote"]:
                    out.append(f"      > {i['source_quote']}")
            out.append("")
    if questions:
        out += ["## Open questions", ""]
        for q in questions:
            tail = [_stop(q["question"])]
            if q["raised_by"]:
                tail.append(f"Raised by {q['raised_by']}.")
            if q["why_open"]:
                tail.append(_stop(q["why_open"]))
            out.append(f"- {' '.join(tail)}")
        out.append("")
    return "\n".join(out)


def commit(run: str, summary: str, items: list, questions: list) -> dict:
    """Write the operator-approved items into the run directory. Local files only."""
    d = _run_dir(run)
    payload = {
        "approved_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "model": MODEL,
        "summary": summary,
        "items": items,
        "questions": questions,
    }
    (d / "actions.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False),
                                    encoding="utf-8")
    md = _markdown(summary, items, questions)
    (d / "actions.md").write_text(md, encoding="utf-8")
    return {"run": run, "dir": str(d), "items": len(items), "questions": len(questions)}
