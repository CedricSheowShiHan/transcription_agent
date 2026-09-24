"""Shared turn-loop for the three tool-calling Gemini passes (agent.propose, memo.think,
memory.learn).

Each of those hands the model a set of tools and lets it decide how many turns it needs,
executing whatever it asks for and feeding the results back until it stops calling tools or a
turn ceiling is hit. The mechanics around that - retrying a call with backoff, folding
`usage_metadata` into a running total, checking whether the model is still calling tools, and
appending the request/response bookkeeping to `contents` - were identical in all three; what
differs is the event-type prefix, how many turns each allows, and what a tool call actually
does. That part stays with each caller as a `dispatch` callback; everything after the loop
(building the final `*_end` event) stays there too, since it is genuinely different per pass.
"""
import asyncio

from google.genai import types

from cleaner import MODEL, RETRIES, _fatal, _why


async def run_turns(client, contents: list, config, dispatch, usage: dict, *, prefix: str,
                     max_turns: int, include_status: bool = True,
                     note_on_exhaustion: bool = True):
    """Drive up to `max_turns` rounds of `generate_content`, yielding progress events.

    `contents` and `usage` are mutated in place, so the caller's post-loop code (building its
    own `*_end` event) sees the final conversation and token counts without needing anything
    returned. `dispatch(name, args) -> status` applies one tool call and returns the status
    string sent back to the model as its function response.

    Yields `{prefix}_retry`, `{prefix}_error`, `{prefix}_call` and, if `note_on_exhaustion`,
    `{prefix}_note` - the same events each loop used to yield inline. On a fatal (or
    exhausted-retries) error this yields `{prefix}_error` and stops; the caller must check for
    that event type and `return` right after yielding it onward, matching the original control
    flow where no final `*_end` event follows a failure.

    `include_status` controls whether the `{prefix}_call` event carries a `status` field -
    agent.py and memo.py include it, memory.py deliberately does not (the status is still sent
    back to the model either way, just left out of the event).
    """
    for turn in range(max_turns):
        resp = None
        for attempt in range(RETRIES + 1):
            try:
                resp = await client.aio.models.generate_content(model=MODEL, contents=contents,
                                                                config=config)
                break
            except Exception as e:
                why = _why(e)
                if _fatal(e) or attempt == RETRIES:
                    yield {"type": f"{prefix}_error", "message": why}
                    return
                yield {"type": f"{prefix}_retry", "attempt": attempt + 2, "of": RETRIES + 1,
                       "error": why}
                await asyncio.sleep(3 * 2 ** attempt)

        if u := resp.usage_metadata:
            usage["input"] += u.prompt_token_count or 0
            usage["output"] += ((u.candidates_token_count or 0) + (u.thoughts_token_count or 0))

        calls = resp.function_calls or []
        if not calls:
            break  # the model is done and answered in plain text

        contents.append(resp.candidates[0].content)
        replies = []
        for call in calls:
            args = dict(call.args or {})
            status = dispatch(call.name, args)
            if include_status:
                yield {"type": f"{prefix}_call", "name": call.name, "args": args,
                       "status": status, "turn": turn + 1}
            else:
                yield {"type": f"{prefix}_call", "name": call.name, "args": args,
                       "turn": turn + 1}
            replies.append(types.Part.from_function_response(name=call.name,
                                                             response={"status": status}))
        contents.append(types.Content(role="user", parts=replies))
    else:
        # Ran out of turns with the model still calling tools; the caller keeps what it recorded.
        if note_on_exhaustion:
            yield {"type": f"{prefix}_note",
                   "message": f"Stopped after {max_turns} turns. Showing what was recorded "
                              "so far."}
