"""Persistent memory of the people who appear across meetings.

The problem this solves is visible in `runs/`: the same person was transcribed as "Prof Wong",
"Prof Ang" and "Prof Huang" in different runs, and twice within a single run. Each run starts
from nothing, so a name misheard once is misheard again forever.

This module keeps a roster in `memory/people.json`. After a run it reads the transcript and the
extracted items and records who was involved; before a run it feeds what it knows back in, so
the cleaner corrects known names and the agent attributes items to known owners.

Memory is a feedback loop, which means a wrong entry poisons later runs. Two guards: every
entry records which runs it came from (`seen_in`) so a bad one can be traced, and `forget()`
removes one by name. Nothing here reaches outside this directory.
"""
import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types

from cleaner import MODEL, RETRIES, TEMPERATURE, THINKING_LEVEL, _fatal, _why
from prompts import build_memory_system, build_memory_user

STORE = Path(__file__).parent / "memory" / "people.json"
# The operator's own glossary - acronyms and product names, the things no transcript spells out.
# It is the same list every week, so it is remembered rather than retyped.
GLOSSARY = Path(__file__).parent / "memory" / "glossary.txt"
MAX_GLOSSARY = 20000
MAX_TURNS = 4
MEMORY_MAX_TOKENS = 8000
MAX_PEOPLE = 200
# How many people to feed back into a prompt. The roster grows; the context should not.
CONTEXT_LIMIT = 40

_PERSON = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Best spelling of the person's name, using "
                                                  "the glossary or known roster where it "
                                                  "settles it."},
        "org": {"type": "string", "description": "Organisation or side they speak for."},
        "role": {"type": "string", "description": "What they do, if the transcript says."},
        "aliases": {"type": "array", "items": {"type": "string"},
                    "description": "Other spellings this transcript used for the same person, "
                                   "including obvious mishearings. Do not include the name."},
        "note": {"type": "string", "description": "One line worth remembering next time: what "
                                                  "they own, decide, or care about."},
    },
    "required": ["name"],
}

TOOLS = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="remember_person", parameters_json_schema=_PERSON,
        description="Record one person who took part in or was discussed at this meeting."),
])


def _slug(name: str) -> str:
    """Match key: case- and punctuation-insensitive, and title-insensitive.

    'Prof. Wong', 'prof wong' and 'Wong' collapse to the same key, which is what lets a later
    run recognise someone the transcript spelled differently.
    """
    s = re.sub(r"\b(prof(essor)?|dr|mr|mrs|ms|miss|sir)\b\.?", " ", name.lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _sort(people: list) -> None:
    """One order everywhere: people not yet seen in a meeting, then the most often seen.

    Display order and prompt order have to agree. When they did not, someone added by hand was
    fed into the run first and shown last, so it looked like the app had ignored them. Only
    entries with no meetings get the lift - a hand-corrected name already has a meeting count,
    and does not deserve to outrank someone who turns up every week.
    """
    people.sort(key=lambda p: (p["meetings"] > 0, -p["meetings"], p["name"].lower()))


def load() -> dict:
    if not STORE.is_file():
        return {"people": []}
    try:
        d = json.loads(STORE.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) and isinstance(d.get("people"), list) else {"people": []}
    except (json.JSONDecodeError, OSError):
        return {"people": []}


def save(d: dict) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")


def read_glossary() -> str:
    try:
        return GLOSSARY.read_text(encoding="utf-8")
    except OSError:
        return ""


def write_glossary(text: str) -> str:
    GLOSSARY.parent.mkdir(parents=True, exist_ok=True)
    text = text[:MAX_GLOSSARY]
    GLOSSARY.write_text(text, encoding="utf-8")
    return text


def add(name: str, org: str = "", role: str = "", note: str = "") -> dict:
    """Add someone the pipeline has not met yet.

    The roster is otherwise written by the memory pass, so it only ever knows people a
    transcript already named. This is the way in for the context nobody says out loud: who
    somebody is, which side they are on, what they own.
    """
    d = load()
    if not (name := name.strip()):
        raise ValueError("A name is needed.")
    if (other := _find(d["people"], name)) is not None:
        raise ValueError(f"{other['name']} is already remembered.")
    if len(d["people"]) >= MAX_PEOPLE:
        raise ValueError(f"The roster is full at {MAX_PEOPLE} people.")

    now = datetime.now().astimezone().isoformat(timespec="seconds")
    person = {"name": name, "org": org.strip(), "role": role.strip(), "aliases": [],
              "notes": [n] if (n := note.strip()) else [],
              "first_seen": now, "last_seen": now, "meetings": 0, "seen_in": [],
              "pinned": True}  # written by hand, so no later run may rename it
    d["people"].append(person)
    _sort(d["people"])
    d["updated_at"] = now
    save(d)
    return {"person": person, "people": d["people"]}


def forget(name: str) -> dict:
    """Drop one person. The escape hatch for a bad entry feeding itself forward."""
    d = load()
    key = _slug(name)
    before = len(d["people"])
    d["people"] = [p for p in d["people"] if _slug(p["name"]) != key
                   and key not in {_slug(a) for a in p.get("aliases", [])}]
    save(d)
    return {"removed": before - len(d["people"]), "people": len(d["people"])}


def _find(people: list, name: str) -> dict | None:
    """Locate one person by the slug of their name or any of their aliases."""
    key = _slug(name)
    return next((p for p in people if _slug(p["name"]) == key
                 or key in {_slug(a) for a in p.get("aliases", [])}), None)


def edit(name: str, new_name: str = "", org: str | None = None, role: str | None = None,
         note: str | None = None, aliases: list | None = None) -> dict:
    """Correct one entry by hand.

    The roster is written by a model reading imperfect transcripts, so it will sometimes get a
    name, an employer or a merge wrong - and because memory feeds every later run, a wrong entry
    stays wrong. This is the correction, and it wins: an edited name is `pinned`, so `merge()`
    will not rewrite it however a later transcript spells it.
    """
    d = load()
    hit = _find(d["people"], name)
    if hit is None:
        raise ValueError(f"No one called {name} is remembered.")

    was, renamed = hit["name"], False
    if (n := (new_name or "").strip()) and n != was:
        if _slug(n) != _slug(was):
            other = _find([p for p in d["people"] if p is not hit], n)
            if other is not None:
                raise ValueError(f"{other['name']} is already a separate entry. "
                                 f"Forget one of them first.")
            renamed = True
        hit["name"] = n

    for field, v in (("org", org), ("role", role)):
        if v is not None:
            hit[field] = v.strip()

    if note is not None:
        note = note.strip()
        if not note:
            hit["notes"] = hit["notes"][:-1]
        elif hit["notes"]:
            hit["notes"][-1] = note        # the UI shows the latest note, so that is the one edited
        else:
            hit["notes"] = [note]

    if aliases is not None:
        seen, clean = set(), []
        for a in aliases:
            if (a := (a or "").strip()) and _slug(a) not in seen:
                seen.add(_slug(a))
                clean.append(a)
        hit["aliases"] = clean
    # The old spelling is how transcripts have been saying this person, and they will keep
    # saying it, so a rename keeps it as an alias rather than orphaning the next match.
    if renamed and was not in hit["aliases"]:
        hit["aliases"].append(was)
    hit["aliases"] = [a for a in hit["aliases"] if _slug(a) != _slug(hit["name"])]

    hit["pinned"] = True
    hit["edited_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    _sort(d["people"])
    save(d)
    return {"person": hit, "people": d["people"]}


def merge(found: list, run: str = "") -> dict:
    """Fold this run's people into the store, matching on the slug of name or any alias."""
    d = load()
    index = {}
    for p in d["people"]:
        for k in {_slug(p["name"])} | {_slug(a) for a in p.get("aliases", [])}:
            index[k] = p

    now = datetime.now().astimezone().isoformat(timespec="seconds")
    added = updated = 0
    for f in found:
        name = (f.get("name") or "").strip()
        if not name:
            continue
        keys = {_slug(name)} | {_slug(a) for a in f.get("aliases", []) if a}
        hit = next((index[k] for k in keys if k in index), None)

        if hit is None:
            if len(d["people"]) >= MAX_PEOPLE:
                continue
            hit = {"name": name, "org": "", "role": "", "aliases": [], "notes": [],
                   "first_seen": now, "last_seen": now, "meetings": 0, "seen_in": []}
            d["people"].append(hit)
            added += 1
        else:
            updated += 1
            # A later run may spell the name better; keep the longer form and alias the other.
            # Unless a human has corrected it: `pinned` names are not the model's to rewrite.
            if _slug(name) == _slug(hit["name"]):
                if not hit.get("pinned") and len(name) > len(hit["name"]):
                    hit["name"] = name
            elif name not in hit["aliases"]:
                hit["aliases"].append(name)

        for a in f.get("aliases", []):
            a = (a or "").strip()
            if a and _slug(a) != _slug(hit["name"]) and a not in hit["aliases"]:
                hit["aliases"].append(a)
        # Later runs win on org/role only when they actually say something.
        for field in ("org", "role"):
            if (v := (f.get(field) or "").strip()):
                hit[field] = v
        if (note := (f.get("note") or "").strip()) and note not in hit["notes"]:
            hit["notes"].append(note)
            hit["notes"] = hit["notes"][-4:]  # keep it from growing without bound
        hit["last_seen"] = now
        hit["meetings"] += 1
        if run and run not in hit["seen_in"]:
            hit["seen_in"].append(run)

        for k in keys:
            index[k] = hit

    _sort(d["people"])
    d["updated_at"] = now
    save(d)
    return {"added": added, "updated": updated, "total": len(d["people"])}


# ------------------------------------------------------------ feeding back


def _roster() -> list:
    """The people fed back into a run. The store is already in `_sort` order, so this is a cut.

    Someone added by hand has no meetings yet; without `_sort` putting them first they would be
    the first thing dropped at CONTEXT_LIMIT - exactly backwards, since they are the entries a
    person vouched for.
    """
    return load()["people"][:CONTEXT_LIMIT]


def spellings() -> list[str]:
    """Glossary lines for the cleaner: the canonical name plus what it has been misheard as."""
    out = []
    for p in _roster():
        line = p["name"]
        if p.get("aliases"):
            line += f" (sometimes mis-transcribed as: {', '.join(p['aliases'][:6])})"
        out.append(line)
    return out


def context() -> str:
    """Fuller roster for the agent and memo passes, where org and role drive attribution."""
    people = _roster()
    if not people:
        return ""
    lines = ["People known from previous meetings. Use these spellings, and prefer these as "
             "owners when the transcript refers to them:"]
    for p in people:
        bits = [p["name"]]
        if p.get("aliases"):
            bits.append(f"[also heard as: {', '.join(p['aliases'][:4])}]")
        if p.get("org"):
            bits.append(f"- {p['org']}")
        if p.get("role"):
            bits.append(f"({p['role']})")
        if p.get("notes"):
            bits.append(f"- {p['notes'][-1]}")
        lines.append("  " + " ".join(bits))
    return "\n".join(lines)


def augment(glossary: str, rich: bool = False) -> str:
    """Prepend what memory knows to the operator's glossary.

    Doing it here means cleaner.py, agent.py and memo.py need no changes: they already take a
    glossary and already tell the model to use its spellings.

    `rich` decides how much of each entry goes in. The cleaner runs once per chunk and only
    needs to know how a name is spelled, so it gets the short form. The agent and the memo
    attribute work to people and reason about who can decide what, so they get the roles and
    the notes as well - which is the only reason writing a description is worth anything.
    """
    if rich:
        block = context()
    elif known := spellings():
        block = "Known people from previous meetings:\n" + "\n".join(f"- {s}" for s in known)
    else:
        block = ""
    if not block:
        return glossary
    return f"{block}\n\n{glossary.strip()}" if glossary.strip() else block


# ------------------------------------------------------------------ learn


async def learn(cleaned: str, items: list, run: str = "", glossary: str = ""):
    """Read a finished run and record who was involved. Yields memory_* events; never raises."""
    yield {"type": "memory_start"}
    if not cleaned.strip():
        yield {"type": "memory_error", "message": "Nothing to read."}
        return

    owners = sorted({(i.get("owner") or "").strip() for i in items if i.get("owner")})
    client = genai.Client()
    config = types.GenerateContentConfig(
        tools=[TOOLS],
        system_instruction=build_memory_system(glossary),
        max_output_tokens=MEMORY_MAX_TOKENS,
        temperature=TEMPERATURE,
        thinking_config=None if THINKING_LEVEL is None
        else types.ThinkingConfig(thinking_level=THINKING_LEVEL),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    contents = [types.Content(role="user", parts=[types.Part(
        text=build_memory_user(cleaned, owners, context()))])]
    found = []
    usage = {"input": 0, "output": 0}

    for turn in range(MAX_TURNS):
        resp = None
        for attempt in range(RETRIES + 1):
            try:
                resp = await client.aio.models.generate_content(model=MODEL, contents=contents,
                                                                config=config)
                break
            except Exception as e:
                why = _why(e)
                if _fatal(e) or attempt == RETRIES:
                    yield {"type": "memory_error", "message": why}
                    return
                yield {"type": "memory_retry", "attempt": attempt + 2, "of": RETRIES + 1,
                       "error": why}
                await asyncio.sleep(3 * 2 ** attempt)

        if u := resp.usage_metadata:
            usage["input"] += u.prompt_token_count or 0
            usage["output"] += ((u.candidates_token_count or 0) + (u.thoughts_token_count or 0))

        calls = resp.function_calls or []
        if not calls:
            break

        contents.append(resp.candidates[0].content)
        replies = []
        for call in calls:
            args = dict(call.args or {})
            if call.name == "remember_person" and (args.get("name") or "").strip():
                found.append(args)
                status = f"person {len(found)} recorded"
            else:
                status = f"ignored {call.name}"
            yield {"type": "memory_call", "name": call.name, "args": args, "turn": turn + 1}
            replies.append(types.Part.from_function_response(name=call.name,
                                                             response={"status": status}))
        contents.append(types.Content(role="user", parts=replies))

    stats = merge(found, run)
    yield {"type": "memory_end", "people": load()["people"], "stats": stats, "tokens": usage}
