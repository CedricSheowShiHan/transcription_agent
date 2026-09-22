"""Web layer: serves the UI, extracts uploads, streams cleanup progress as SSE.

Run:  uvicorn app:main --reload --port 3000   (binds to localhost only; keep it that way)
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")  # before anything reads GEMINI_API_KEY

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import agent  # noqa: E402
import cleaner  # noqa: E402
import memo  # noqa: E402
import memory  # noqa: E402

MAX_UPLOAD = 20 * 1024 * 1024

# Named `main` (not `app`) so the command `uvicorn app:main` works as written.
main = FastAPI(title="Transcript cleanup")


class CleanRequest(BaseModel):
    text: str
    glossary: str = ""
    filename: str = ""


class BriefRequest(BaseModel):
    text: str
    glossary: str = ""


class CommitRequest(BaseModel):
    run: str
    summary: str = ""
    items: list[dict] = []
    questions: list[dict] = []


class MemoRequest(BaseModel):
    text: str
    glossary: str = ""
    items: list[dict] = []
    questions: list[dict] = []


class MemoCommitRequest(BaseModel):
    run: str
    decisions: list[dict] = []
    consequences: str = ""


class LearnRequest(BaseModel):
    text: str
    glossary: str = ""
    items: list[dict] = []
    run: str = ""


class ForgetRequest(BaseModel):
    name: str


class AddRequest(BaseModel):
    name: str
    org: str = ""
    role: str = ""
    note: str = ""


class GlossaryRequest(BaseModel):
    text: str


class EditRequest(BaseModel):
    name: str                             # who to edit, as memory currently spells them
    new_name: str = ""
    org: str | None = None                # None leaves a field alone; "" clears it
    role: str | None = None
    note: str | None = None
    aliases: list[str] | None = None


@main.post("/extract")
async def extract(request: Request, name: str):
    """Raw file bytes in the body, filename in ?name=. Returns the plain text that /clean will send."""
    if int(request.headers.get("content-length") or 0) > MAX_UPLOAD:
        raise HTTPException(413, "File is over 20 MB.")
    try:
        return {"text": cleaner.extract_text(name, await request.body())}
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@main.post("/clean")
async def clean(req: CleanRequest):
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
    if not req.text.strip():
        raise HTTPException(400, "Nothing to clean.")

    async def sse():
        async for event in cleaner.clean(req.text, memory.augment(req.glossary), req.filename):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@main.post("/brief")
async def brief(req: BriefRequest):
    """Action items for an already-cleaned transcript, so the UI can regenerate without re-cleaning."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
    if not req.text.strip():
        raise HTTPException(400, "Nothing to summarise.")

    async def sse():
        async for event in cleaner.brief(req.text, memory.augment(req.glossary)):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@main.post("/agent")
async def agent_propose(req: BriefRequest):
    """Agentic pass: the model records items via tool calls. Proposes only; writes nothing."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
    if not req.text.strip():
        raise HTTPException(400, "Nothing to analyse.")

    async def sse():
        async for event in agent.propose(req.text, memory.augment(req.glossary, rich=True)):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@main.post("/commit")
async def commit(req: CommitRequest):
    """Write the operator-approved items to the run directory. Local files only, no external calls."""
    try:
        return agent.commit(req.run, req.summary, req.items, req.questions)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@main.post("/memo")
async def memo_think(req: MemoRequest):
    """Thinking pass: reasons over the transcript and the extracted items. Proposes only."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
    if not req.text.strip():
        raise HTTPException(400, "Nothing to reason about.")

    async def sse():
        async for event in memo.think(req.text, req.items, req.questions, memory.augment(req.glossary, rich=True)):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@main.post("/commit-memo")
async def commit_memo(req: MemoCommitRequest):
    """Write the operator-approved memo to the run directory. Local files only."""
    try:
        return memo.commit(req.run, req.decisions, req.consequences)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@main.post("/learn")
async def learn(req: LearnRequest):
    """Read a finished run and fold the people it mentions into memory/people.json."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(500, "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
    if not req.text.strip():
        raise HTTPException(400, "Nothing to read.")

    async def sse():
        async for event in memory.learn(req.text, req.items, req.run, req.glossary):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@main.get("/memory")
async def read_memory():
    """The roster, so the UI can show what the pipeline already knows before a run starts."""
    return {**memory.load(), "glossary": memory.read_glossary()}


@main.post("/glossary")
async def set_glossary(req: GlossaryRequest):
    """Keep the operator's glossary between runs. It is the same terms every week."""
    return {"text": memory.write_glossary(req.text)}


@main.post("/forget")
async def forget(req: ForgetRequest):
    """Remove one person. Memory feeds later runs, so a wrong entry needs an escape hatch."""
    if not req.name.strip():
        raise HTTPException(400, "No name given.")
    return memory.forget(req.name)


@main.post("/people")
async def add_person(req: AddRequest):
    """Add someone the pipeline has not met. The memory pass only knows who transcripts name."""
    try:
        return memory.add(req.name, req.org, req.role, req.note)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@main.post("/person")
async def edit_person(req: EditRequest):
    """Correct one entry by hand. The roster is model-written, so it needs a human override."""
    if not req.name.strip():
        raise HTTPException(400, "No name given.")
    try:
        return memory.edit(req.name, req.new_name, req.org, req.role, req.note, req.aliases)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


# Last, so it doesn't shadow the API routes.
# The React app in frontend/ builds to frontend/dist; `static/` holds the previous vanilla
# single-file UI and is served only when dist/ is missing (i.e. nobody has run `npm run build`).
_HERE = Path(__file__).parent
_DIST = _HERE / "frontend" / "dist"
_UI = _DIST if (_DIST / "index.html").is_file() else _HERE / "static"


class UI(StaticFiles):
    """Static files, but HTML must revalidate.

    Vite fingerprints its assets, so those can be cached hard. index.html cannot: it is the
    file that points at the current hashes, and StaticFiles sends only an ETag, which lets a
    browser heuristically serve a stale copy after a rebuild - the page looks unchanged even
    though the server has new output.
    """

    async def get_response(self, path, scope):
        r = await super().get_response(path, scope)
        ctype = r.headers.get("content-type", "")
        if ctype.startswith("text/html"):
            r.headers["Cache-Control"] = "no-cache, must-revalidate"
        elif "/assets/" in scope.get("path", ""):
            r.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return r


main.mount("/", UI(directory=_UI, html=True), name="static")
