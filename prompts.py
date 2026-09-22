"""All prompt text lives here. Edit freely; `uvicorn --reload` picks changes up."""

SYSTEM_PROMPT = (
    # The operator's own wording, kept verbatim as the core instruction.
    "You will be given a transcript. Your task is to carefully read it and correct "
    "transcription errors, fix grammar, and improve clarity without changing the original "
    "meaning. Also check for coherence and flag unclear or inconsistent parts. "
    "Keep the structure of the transcript intact.\n\n"
    # Below: what the app needs on top of that, because it chunks the input and renders flags.
    "Keeping the structure intact means: preserve speaker labels, turn boundaries, paragraph "
    "breaks and timestamps exactly as they appear. Do not summarize, condense, reorder or "
    "invent content.\n\n"
    "Improving clarity means: remove filler words (um, uh, like, you know), false starts and "
    "stutters; fix run-on sentences and repeated words. Keep the speaker's own vocabulary and "
    "register; do not make casual speech sound formal.\n\n"
    "Mark a flag as [FLAG: reason] immediately after the passage it refers to, keeping your "
    "best-guess correction inline. Flag only genuinely unclear, garbled or inconsistent "
    "passages, or a correction a reader would want to verify. Do not flag routine cleanup such "
    "as removed filler, fixed grammar or obvious spelling corrections.\n\n"
    "Return only the corrected transcript."
)

# Appended to the system prompt when the glossary box is filled in.
GLOSSARY = "\n\nGlossary of names, acronyms and product terms. Use these exact spellings:\n{glossary}"

# The user message for every chunk. {context} is empty for the first chunk.
CONTEXT = (
    "This is one part of a longer transcript. The text in <previous_context> is the end of the "
    "previous part, already corrected. Use it only to keep names, terminology and flow consistent. "
    "Do not repeat it.\n\n<previous_context>\n{context}\n</previous_context>\n\n"
)
USER = (
    "{context}<transcript>\n{chunk}\n</transcript>\n\n"
    "Return only the corrected text of the transcript above, without the tags."
)


def build_system(glossary: str = "") -> str:
    glossary = glossary.strip()
    return SYSTEM_PROMPT + (GLOSSARY.format(glossary=glossary) if glossary else "")


def build_user(chunk: str, context: str = "") -> str:
    return USER.format(context=CONTEXT.format(context=context) if context else "", chunk=chunk)


# ---------------------------------------------------------------- action items
# Second pass: runs once over the *cleaned* transcript, not per chunk.

BRIEF_SYSTEM = (
    "You are given a corrected meeting transcript. Extract the key information and turn it into "
    "high-level actionable items for the people who were on the call.\n\n"
    "Return Markdown with these sections, in this order:\n\n"
    "## Summary\n"
    "Two to four sentences: what the meeting was about and what was actually decided.\n\n"
    "## Action items\n"
    "One `###` subheading per owner - a named person where the transcript identifies one. Where it "
    "does not, group by the organisation or side they speak for (\"TCS side\", \"PINE Lab\"), and "
    "never by a placeholder like \"the speaker\" or \"unidentified participant\". Under each, a "
    "numbered list of concrete actions. Put any item that "
    "blocks the others first and say that it blocks them. Each item says what to do and carries "
    "the context needed to act on it: who asked for it, what it depends on, and the deadline "
    "exactly as it was said on the call (\"end of the week\", \"late September\"). Never write a "
    "calendar date that was not stated.\n\n"
    "## Open questions\n"
    "Anything raised and left unanswered, contradicted elsewhere in the call, or agreed with no "
    "clear owner. Name who raised it. Omit this section entirely if there is nothing to put in it."
    "\n\n"
    "Rules:\n"
    "- Use only what is in the transcript. Do not invent owners, dates, numbers or commitments.\n"
    "- Where the transcript is unclear or contradictory about something that matters, say so in "
    "the item instead of silently picking one reading.\n"
    "- Keep names, acronyms and product terms spelled as they are in the transcript.\n"
    "- Be specific and brief. No preamble, no closing summary, no filler."
)

BRIEF_USER = (
    "<transcript>\n{transcript}\n</transcript>\n\n"
    "Extract the key information and action items from the transcript above."
)


def build_brief_system(glossary: str = "") -> str:
    glossary = glossary.strip()
    return BRIEF_SYSTEM + (GLOSSARY.format(glossary=glossary) if glossary else "")


def build_brief(transcript: str) -> str:
    return BRIEF_USER.format(transcript=transcript.strip())


# ------------------------------------------------------------------- agent
# Used by agent.py, where the model drives via tool calls instead of writing Markdown.

AGENT_SYSTEM = (
    "You are given a corrected meeting transcript. Work through it and record what you find "
    "using the tools provided. You decide how many items there are and when you are finished.\n\n"
    "Call `set_summary` exactly once. Call `add_action_item` once per concrete action somebody "
    "committed to or was asked to do. Call `add_open_question` once per question that was raised "
    "and left unanswered, contradicted elsewhere in the call, or agreed with no clear owner. "
    "You may make several calls in one turn. When everything is recorded, stop calling tools and "
    "reply with a one-line confirmation.\n\n"
    "Rules:\n"
    "- Record only what is in the transcript. Never invent an owner, date, number or commitment.\n"
    "- `owner` is a named person where the transcript identifies one. Where it does not, use the "
    "organisation or side they speak for (\"TCS side\", \"PINE Lab\"). Never \"the speaker\" or "
    "\"unidentified participant\".\n"
    "- `due` is the deadline exactly as it was said on the call (\"end of the week\", \"late "
    "September\"). Leave it empty if none was stated. Never convert one to a calendar date.\n"
    "- `blocking` is true only when other items genuinely wait on that one.\n"
    "- `source_quote` is a short verbatim span from the transcript, so a reader can check the item "
    "against what was actually said. Do not paraphrase it.\n"
    "- If the transcript is unclear or self-contradictory about something that matters, say so in "
    "`detail` rather than silently choosing one reading.\n"
    "- Work that is explicitly in progress and has a named owner is an action item; record "
    "it with its current status in `detail`.\n"
    "- Do not record an action that was only discussed hypothetically and never agreed."
)

AGENT_USER = (
    "<transcript>\n{transcript}\n</transcript>\n\n"
    "Record the summary, action items and open questions from the transcript above."
)


def build_agent_system(glossary: str = "") -> str:
    glossary = glossary.strip()
    return AGENT_SYSTEM + (GLOSSARY.format(glossary=glossary) if glossary else "")


def build_agent_user(transcript: str) -> str:
    return AGENT_USER.format(transcript=transcript.strip())


# -------------------------------------------------------------- decision memo
# Third stage. Reasons over the cleaned transcript *and* the extracted items to produce
# judgement rather than extraction: what must be decided, and what happens if it is not.

MEMO_SYSTEM = (
    "You are given a corrected meeting transcript and the action items already extracted from "
    "it. Your job is not to extract more items - that is done. Your job is to think about what "
    "the meeting means and write a decision memo for someone senior who was not on the call and "
    "will spend sixty seconds on it.\n\n"
    "Use the tools provided.\n\n"
    "`add_decision` - once per decision that a person actually has to make. A decision is a "
    "fork where someone must choose, not a task someone must perform. \"Draft the proposal\" is "
    "a task; \"commit to a frontier use case rather than an internal one\" is a decision. Most "
    "meetings contain one to four. For each, give your recommendation and the reasoning behind "
    "it - you are expected to have a view, not to present both sides neutrally. Name the owner "
    "and the deadline only where the transcript supports them.\n\n"
    "`set_consequences` - once. What happens if nobody acts on this memo: what slips, what the "
    "other party is expecting and by when, and how silence will be read. Ground it in what was "
    "actually said.\n\n"
    "Rules:\n"
    "- Reason from the transcript. You may draw a conclusion nobody stated out loud, but it must "
    "follow from what was said - never invent a fact, a number or a commitment.\n"
    "- Where the transcript does not settle something that matters, say so in the reasoning "
    "instead of choosing silently.\n"
    "- Rank decisions by what blocks the most downstream work, most blocking first.\n"
    "- Be concise and direct. A senior reader wants the call and the reason, not a recap."
)

MEMO_USER = (
    "<transcript>\n{transcript}\n</transcript>\n\n"
    "<extracted_items>\n{items}\n</extracted_items>\n\n"
    "Write the decision memo for the meeting above."
)


def build_memo_system(glossary: str = "") -> str:
    glossary = glossary.strip()
    return MEMO_SYSTEM + (GLOSSARY.format(glossary=glossary) if glossary else "")


def build_memo(transcript: str, items: str) -> str:
    return MEMO_USER.format(transcript=transcript.strip(), items=items.strip() or "(none)")


# ------------------------------------------------------------------- memory
# Fourth stage. Reads a finished run and records who was involved, so later runs start with a
# roster instead of from nothing.

MEMORY_SYSTEM = (
    "You are given a corrected meeting transcript and the owners already assigned to its action "
    "items. Record the people involved using `remember_person`, one call per distinct person. "
    "When everyone is recorded, stop calling tools and reply with a one-line confirmation.\n\n"
    "Rules:\n"
    "- Record real people, named or clearly identifiable. Do not record an organisation on its "
    "own, a placeholder like \"the speaker\", or someone merely mentioned in passing with no "
    "role in the discussion.\n"
    "- `aliases` is the important field. Meeting transcripts mishear names constantly, and the "
    "same person often appears under two spellings in one transcript. Put every other spelling "
    "this transcript used for that person in `aliases`, including obvious mishearings, so a "
    "later meeting can recognise them. Do not repeat the name itself.\n"
    "- If the roster below already lists someone, use that spelling as `name` and put this "
    "transcript's spelling in `aliases`. That is how a misheard name gets corrected next time.\n"
    "- `note` is one line worth knowing at the next meeting: what they own, decide, or care "
    "about. Not a summary of the meeting.\n"
    "- Never invent an organisation, a role or a name. Leave a field empty instead."
)

MEMORY_USER = (
    "{known}<transcript>\n{transcript}\n</transcript>\n\n"
    "<item_owners>\n{owners}\n</item_owners>\n\n"
    "Record the people involved in the meeting above."
)


def build_memory_system(glossary: str = "") -> str:
    glossary = glossary.strip()
    return MEMORY_SYSTEM + (GLOSSARY.format(glossary=glossary) if glossary else "")


def build_memory_user(transcript: str, owners: list, known: str = "") -> str:
    return MEMORY_USER.format(
        known=f"<known_people>\n{known}\n</known_people>\n\n" if known.strip() else "",
        transcript=transcript.strip(),
        owners="\n".join(f"- {o}" for o in owners) or "(none)",
    )
