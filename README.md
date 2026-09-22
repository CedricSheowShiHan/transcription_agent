# Transcript cleanup

Local tool that cleans up raw meeting transcripts with Gemini, then has an agent pull out the action items. FastAPI backend, React frontend. Nothing is stored or sent anywhere except the Google Gemini API call; runs are written to `runs/` on this machine.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then put your key in .env

cd frontend && npm install && npm run build && cd ..   # builds the React UI into frontend/dist
uvicorn app:main --reload --port 3000
```

The frontend is a React + Vite app in `frontend/`. `app.py` serves `frontend/dist` when it
exists and falls back to the old vanilla single-file UI in `static/` when it does not, so the
API works either way. **Rebuild after changing anything under `frontend/src`** - uvicorn's
`--reload` only watches `.py` files. For UI work run `npm run dev` in `frontend/` instead: it
serves on :5173 with hot reload and proxies the API routes to uvicorn on :3000.

Open http://localhost:3000. The page and the API are one server on that port. Keep uvicorn on its default `127.0.0.1`; don't add `--host 0.0.0.0`. Restart uvicorn after editing `.env` (the reloader only watches `.py` files).

## Use

1. Drop or pick a `.txt`, `.md`, `.vtt`, `.srt` or `.docx`, or paste text. Optionally list names, acronyms and product terms in the glossary.
2. **Clean transcript.** Progress shows chunk n of m, tokens and elapsed time. The cleaned text fills in as it streams.
3. **The agent runs automatically** once cleaning finishes, and its proposals appear at the top: a summary, actions grouped by owner with any blocking item first, and open questions. Each item carries the deadline as spoken and a verbatim `source_quote` so you can check it against what was actually said.
4. **Review and approve.** Untick anything you don't want. **Approve & save** writes only the ticked items to `runs/<id>/actions.json` and `actions.md`. Nothing is written until you press it. **Re-run agent** redoes the pass over the text on screen.
5. **People** are recorded after every run and fed back into the next one. The roster is on the page before a run and on the People tab during one: **Add person** enters someone no transcript has named yet, and hovering a row lets you correct it by hand or forget them. The description you write is read on every later run.
6. **Decision memo.** A third pass then reasons over the transcript *and* the extracted items and writes a memo for someone who was not on the call: the decisions somebody actually has to make, a recommendation with reasoning for each, and what happens if nobody acts. Its **Approve & save** writes `memo.json` and `memo.md`.
7. On the Transcript tab, the corrected transcript: original left, cleaned right, scroll-synced. `[FLAG: reason]` spans are highlighted and listed in the flags panel; click one to jump to it.

## How it works

- **Extraction** (`POST /extract`, so the UI can show the word count on load): `.vtt`/`.srt` cues become `[start --> end] Speaker: text` paragraphs, so timestamps stay attached to their text. `.docx` is read from its XML, no extra dependency.
- **Chunking** (`cleaner.chunk`): about 3000 words, split only on paragraph boundaries. A paragraph longer than a chunk falls back to lines, then sentences. Concatenating the chunks gives back the input exactly.
- **Context:** each chunk after the first also gets the last two turns of the *cleaned* previous chunk, marked as context-only. That is the two-turn overlap and the consistency tail in one, and the model doesn't re-emit those turns, so there is nothing to de-duplicate.
- **The agent** (`agent.propose`, `POST /agent`): this is the one part of the app where the model drives. It is given three tools - `set_summary`, `add_action_item`, `add_open_question` - and decides for itself how many items exist, what to call each one, and when it is finished; `agent.py` runs the loop and feeds each result back. `MAX_TURNS` caps it at 8 turns, `MAX_ITEMS` at 60, because a model-driven loop needs a ceiling it cannot raise itself. Deadlines are copied as spoken ("end of the week"), never converted to calendar dates. A failure here is reported and skipped - the transcript is already cleaned and saved.
- **The thinking agent** (`memo.think`, `POST /memo`): stage three, and the only stage whose value is the reasoning rather than the reading. It gets the cleaned transcript *and* stage two's items, and has two tools - `add_decision` and `set_consequences`. A decision is a fork somebody must choose, not a task somebody must perform; the prompt asks it to take a view rather than present both sides. It runs at `MEMO_THINKING = "HIGH"` while everything else runs at `LOW`, because here the thinking is the product. `POST /commit-memo` writes `memo.json` and `memo.md`.
- **Memory** (`memory.py`, `POST /learn`, `GET /memory`, `POST /forget`): the roster in `memory/people.json`. After a run it records who was involved, with every other spelling that run used for them in `aliases`; before a run, `memory.augment()` prepends the roster to the glossary, so the cleaner corrects known names and the agent attributes items to known owners. The cleaner gets names and aliases only - it runs once per chunk and spelling is all it needs - while `/agent` and `/memo` pass `rich=True` for roles and descriptions too, since those stages decide who owns what and who can settle a question. `POST /people` adds someone by hand, which is the only way in for a person no transcript names. `app.py` calls `augment` on the way into every stage, which is why `cleaner.py`, `agent.py` and `memo.py` needed no changes - they already take a glossary. The glossary box is remembered the same way, in `memory/glossary.txt` (`POST /glossary`), and it is only for what memory cannot learn - acronyms and product names - since the roster is prepended automatically and listing the same people again only pays for saying it twice. This is a feedback loop, so a wrong entry compounds: each person records the runs it came from in `seen_in`, `POST /forget` removes one, and `POST /person` corrects one. A hand-corrected name is `pinned` - `merge()` will not rewrite it however a later transcript spells it - and the spelling it replaced is kept as an alias, so transcripts that still use the old name match the same person instead of creating a second one.
- **Approval** (`agent.commit`, `POST /commit`): the agent proposes; nothing reaches disk until you tick items and press Approve & save. `commit` writes `actions.json` and `actions.md` into the run directory and nowhere else - the run name is validated against `^[\w.-]+$` and its resolved path must sit directly inside `runs/`, so a crafted name cannot escape. There are no external integrations: if you wire one in later, keep the approval gate in front of it.
- **`cleaner.brief` / `POST /brief`** is the older non-agentic version of the same step: one call, Markdown out, no tools. Unused by the UI, kept as a cheaper and more predictable fallback.
- **Failures:** each chunk gets 3 attempts (backoff 3s, 6s). A chunk that still fails, returns a `finish_reason` other than `STOP`, or comes back under 60% of its input length is emitted as `[CHUNK FAILED]` plus the original text. Errors no retry can fix (bad key, unknown model, rejected parameter, billing: 400/401/402/403/404/413) stop the run immediately instead. A 429 rate limit is retried, not fatal.
- **Stop** ends the run. Unfinished chunks export as `[CHUNK NOT CLEANED]` plus the original text, so nothing is silently dropped. The chunks that did finish are still written to `runs/`.
- The token counter counts successful attempts only; a failed attempt's tokens are still billed but not shown.

## Runs

Every run writes `runs/<timestamp>-<name>/` with `input.txt`, `output.txt`, `system_prompt.txt` (system prompt plus glossary as sent) and `meta.json` (timestamp, model, tokens, failed chunks). Approving the agent's proposals adds `actions.json` (structured, with `source_quote` per item) and `actions.md` (a checklist). Compare prompt versions with `diff -r runs/A runs/B`. These are your confidential transcripts in plain text, so keep `runs/` and `.env` out of version control.

## Tuning

- Prompt text (cleanup prompt, action-items prompt, glossary suffix, per-chunk wrapper): `prompts.py`. It reloads on save.
- Action-items output cap: `BRIEF_MAX_TOKENS` in `cleaner.py`.
- Agent turn and item ceilings, and the tool schemas: `agent.py`.

## Is this an agent?

Partly, and only in one place. Extraction, chunking, the per-chunk cleanup loop and the retries are ordinary code - `cleaner.py` decides all of it, and the model only returns text. That part is a pipeline, deliberately: the steps are known in advance, so `temperature=0` and a file-per-step audit trail in `runs/` are worth more than autonomy.

The action-items step (`agent.py`) is genuinely agentic: the model has tools, chooses which to call and how often, and decides when it is done. That earns its keep because the number of action items is not knowable in advance. It is also the only step that could write anywhere, which is why approval sits in front of it.
- Model, chunk size, context turns, retries, max tokens: constants at the top of `cleaner.py`.

## Frontend

React 19 + Vite + Tailwind v4, with `motion` for animation and `lucide-react` for icons.

- `src/App.tsx` holds the run state machine (clean -> agent -> approve) and the SSE handlers.
- `src/lib/scan.ts` is the flag parser; `src/lib/sse.ts` reads the `data:` frames.
- `src/components/` is the UI. `Transcript.tsx` keeps the chunk-level scroll sync.

### Design tokens

The palette is not invented: it was mined from the source of all 778 components in
[Watermelon UI](https://ui.watermelon.sh)'s registry, taking the values they actually use most.
Near-white surfaces (`#FEFEFE` / `#F6F5FA`), Apple-ish neutral greys, one indigo accent
(`#6366F1`), soft `shadow-sm`, generous rounding (`rounded-lg` and `rounded-full` dominate
their source), and springs at stiffness 300 / damping 30.

Tokens live in `src/index.css` under `@theme`, with the dark values redefined on `.dark` using
the same names - so components are written once in terms of `bg-surface`, `text-dim`,
`border-edge` and work in both themes. The header toggle sets the class; it defaults to the
system setting.

`watermelon-reference/` holds components pulled verbatim from that registry, outside `src/` so
they are neither type-checked nor bundled. The app adapts their motion patterns rather than
importing them, because each ships its own palette and hardcoded demo props; that folder's
README maps each reference to where its pattern ended up.

### Gotchas

- **Rebuild after editing `frontend/src`.** uvicorn's `--reload` only watches `.py`.
- `runAgent` is called from inside `start`'s async body, so it must not read `chunks` from the
  render closure - it would still be `[]`. Chunk text is assembled from `chunksRef` for exactly
  that reason.
- `app.py` sends `Cache-Control: no-cache` for HTML and a one-year immutable cache for
  `/assets/*`. Without that, browsers heuristically cache `index.html` and a rebuild looks like
  nothing changed.

## Model notes

- `gemini-3.8-flash` is the default, checked against a live `models.list()` on 2026-09-21. For transcripts where flash drops detail, switch `MODEL` to `gemini-3.1-pro-preview` or `gemini-2.5-pro`.
- **`temperature=0` is sent**, so runs are near-deterministic. Change `TEMPERATURE` in `cleaner.py` to loosen that.
- Gemini thinks by default and **thinking tokens count against `max_output_tokens`**, which is why `MAX_TOKENS` sits well above the expected output. The token counter folds `thoughts_token_count` into the output total, since it is billed as output.
- **`THINKING_LEVEL = "LOW"` is the single biggest cost lever.** Measured on a 2,491-word transcript: the model default spent 10,442 thinking tokens against 3,105 of actual content - 77% of output spend was reasoning you never see. `LOW` produces 0 thinking tokens for the same content, cutting the cleaning pass from 13,547 output tokens to 2,851, and it lost nothing: it still caught `"a video"` -> Nvidia and `"4 to 6"` -> TRL 4-6, and preserved *more* paragraph structure (46 vs 40). What `HIGH` mostly bought was over-flagging (55 flags vs 13). Raise it if a transcript is garbled enough that `LOW` misses real errors.
- **The memo stage dominates cost.** On a 2,491-word transcript the three stages measured roughly 3k / 8k / 54k input tokens - the memo runs several turns at `HIGH` thinking and each turn resends the conversation, so it is worth perhaps 5x the rest of the pipeline combined. If that is too much: lower `MEMO_THINKING` to `"MEDIUM"`, cut `MAX_TURNS` in `memo.py`, or drop the automatic call in `App.tsx`'s `runAgent` and run it only from the **Re-think** button.
- `gemini-3.x` **ignores `thinking_budget`** - it silently yields zero thinking. Use `thinking_level` (`LOW` / `MEDIUM` / `HIGH`; `MINIMAL` is rejected on 3.8-flash).
- The app reads `GEMINI_API_KEY`. The SDK also accepts `GOOGLE_API_KEY`, but `app.py` checks the former.

There are no tests, as requested.
