"""Third stage: the thinking agent.

Stages one and two are extraction - the cleaner rewrites what was said, and `agent.propose`
records the items that were said. Neither is asked to have a view. This stage is, and that is
the whole difference: it reasons over the transcript *and* the extracted items to produce a
decision memo - what a person actually has to choose, what it should be, and what happens if
nobody acts.

Because this is the one stage whose value is the reasoning, it runs at a higher thinking level
than the rest of the pipeline (see MEMO_THINKING). Cleaning gets nothing from thinking and was
measured to waste 77% of its output tokens on it; here it is the point.
"""
import json
from datetime import datetime
from pathlib import Path

from google import genai
from google.genai import types

from agent import _run_dir, _stop
from cleaner import MODEL, TEMPERATURE
from gemini_loop import run_turns
from prompts import build_memo, build_memo_system

MAX_TURNS = 6
MEMO_MAX_TOKENS = 16000
MAX_DECISIONS = 12
# Deliberately higher than cleaner.THINKING_LEVEL: judgement is what this stage sells.
MEMO_THINKING = "HIGH"

_DECISION = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "The choice to be made, as a short phrase. "
                                                   "A fork someone must pick, not a task."},
        "recommend": {"type": "string", "description": "Your recommended option. Take a view."},
        "why": {"type": "string", "description": "The reasoning, grounded in what was said. "
                                                 "Say so if the transcript does not settle it."},
        "owner": {"type": "string", "description": "Who decides, if the transcript supports it."},
        "by_when": {"type": "string", "description": "Deadline exactly as spoken. Empty if none."},
        "blocks": {"type": "string", "description": "What downstream work waits on this. Empty "
                                                    "if nothing does."},
    },
    "required": ["title", "recommend", "why"],
}
_CONSEQUENCES = {
    "type": "object",
    "properties": {
        "consequences": {"type": "string", "description": "What happens if nobody acts: what "
                                                          "slips, who is waiting, how silence "
                                                          "will be read."},
    },
    "required": ["consequences"],
}

TOOLS = types.Tool(function_declarations=[
    types.FunctionDeclaration(name="add_decision", parameters_json_schema=_DECISION,
                              description="Record one decision somebody has to make, with your "
                                          "recommendation. Most blocking first."),
    types.FunctionDeclaration(name="set_consequences", parameters_json_schema=_CONSEQUENCES,
                              description="Record what happens if nobody acts. Call once."),
])


def _c(v, default=""):
    return v.strip() if isinstance(v, str) else default


def _items_as_text(items: list, questions: list) -> str:
    """The stage-two output, flattened so the model reasons over it alongside the transcript."""
    out = []
    for i in items:
        bits = [f"- {i.get('title', '')}"]
        if i.get("owner"):
            bits.append(f"(owner: {i['owner']})")
        if i.get("due"):
            bits.append(f"(due: {i['due']})")
        if i.get("blocking"):
            bits.append("(blocks other items)")
        out.append(" ".join(bits))
        if i.get("detail"):
            out.append(f"    {i['detail']}")
    if questions:
        out.append("\nUnanswered:")
        for q in questions:
            tail = f" (raised by {q['raised_by']})" if q.get("raised_by") else ""
            out.append(f"- {q.get('question', '')}{tail}")
    return "\n".join(out)


async def think(cleaned: str, items: list, questions: list, glossary: str = ""):
    """Async generator of memo events. Never raises; a failure is reported as `memo_error`."""
    yield {"type": "memo_start"}
    if not cleaned.strip():
        yield {"type": "memo_error", "message": "Nothing to reason about."}
        return

    client = genai.Client()
    config = types.GenerateContentConfig(
        tools=[TOOLS],
        system_instruction=build_memo_system(glossary),
        max_output_tokens=MEMO_MAX_TOKENS,
        temperature=TEMPERATURE,
        thinking_config=types.ThinkingConfig(thinking_level=MEMO_THINKING),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    contents = [types.Content(role="user", parts=[types.Part(
        text=build_memo(cleaned, _items_as_text(items, questions)))])]
    decisions, consequences = [], ""
    usage = {"input": 0, "output": 0}

    def record(name: str, args: dict) -> str:
        nonlocal consequences
        if name == "set_consequences":
            consequences = _c(args.get("consequences"))
            return "consequences recorded"
        if name == "add_decision":
            if len(decisions) >= MAX_DECISIONS:
                return "limit reached; stop adding decisions"
            decisions.append({
                "title": _c(args.get("title")),
                "recommend": _c(args.get("recommend")),
                "why": _c(args.get("why")),
                "owner": _c(args.get("owner")),
                "by_when": _c(args.get("by_when")),
                "blocks": _c(args.get("blocks")),
            })
            return f"decision {len(decisions)} recorded"
        return f"unknown tool {name}"

    async for ev in run_turns(client, contents, config, record, usage,
                              prefix="memo", max_turns=MAX_TURNS):
        yield ev
        if ev["type"] == "memo_error":
            return

    yield {"type": "memo_end", "decisions": decisions, "consequences": consequences,
           "tokens": usage}


# ------------------------------------------------------------------- commit


def markdown(decisions: list, consequences: str) -> str:
    out = ["# Decision memo", ""]
    if decisions:
        out += ["## Decisions required", ""]
        for n, d in enumerate(decisions, 1):
            out.append(f"**{n}. {d['title'].rstrip('.')}**")
            out.append("")
            out.append(f"- **Recommend:** {_stop(d['recommend'])}")
            out.append(f"- **Why:** {_stop(d['why'])}")
            meta = []
            if d.get("owner"):
                meta.append(f"**Owner:** {d['owner']}")
            if d.get("by_when"):
                meta.append(f"**By:** {d['by_when']}")
            if meta:
                out.append("- " + "  ·  ".join(meta))
            if d.get("blocks"):
                out.append(f"- **Blocks:** {_stop(d['blocks'])}")
            out.append("")
    if consequences:
        out += ["## If nothing is done", "", consequences, ""]
    return "\n".join(out)


def commit(run: str, decisions: list, consequences: str) -> dict:
    """Write the approved memo into the run directory. Local files only."""
    d = _run_dir(run)
    (d / "memo.json").write_text(
        json.dumps({
            "approved_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "model": MODEL,
            "thinking_level": MEMO_THINKING,
            "decisions": decisions,
            "consequences": consequences,
        }, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (d / "memo.md").write_text(markdown(decisions, consequences), encoding="utf-8")
    return {"run": run, "dir": str(d), "decisions": len(decisions)}
