import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, ListChecks, Moon, RefreshCw, Save, ScrollText, Sun, Users, Waves } from 'lucide-react';
import { Btn, Card, CopyBtn, Rail, Stat, Ticker } from './components/Bits';
import { InputPanel } from './components/InputPanel';
import { ActionItems } from './components/ActionItems';
import { MemoPanel } from './components/MemoPanel';
import { People } from './components/People';
import { Transcript } from './components/Transcript';
import { Tabs } from './components/Tabs';
import { ToastStack, useToasts, type ToastKind } from './components/Toast';
import { postStream } from './lib/sse';
import { applyChunk, clock, num, words } from './lib/scan';
import type {
  Agent, Chunk, Decision, Item, Memo, Person, PersonEdit, Phase, Question, ScanState,
} from './lib/types';

const TOKENS0 = { input: 0, output: 0 };

export default function App() {
  const [text, setText] = useState('');
  const [gloss, setGloss] = useState('');
  const [filename, setFilename] = useState('');
  const [openInput, setOpenInput] = useState(true);
  // Off by default: the memo stage alone can cost several times what cleaning does. The
  // people-memory pass always runs regardless - it's cheap and only improves future runs.
  const [deepAnalysis, setDeepAnalysis] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [chunks, setChunks] = useState<Chunk[]>([]);
  // Per-flag operator overrides: flag id -> replacement text. Absent means "accept the model's
  // wording as-is". Applied live in the Cleaned pane and, via `cleaned()` below, in every export
  // and every downstream pass so an edit here doesn't need separate wiring anywhere else.
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [tokens, setTokens] = useState(TOKENS0);
  const [runId, setRunId] = useState('');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [learnStats, setLearnStats] = useState<{ added: number; updated: number } | null>(null);
  const [tab, setTab] = useState('actions');
  const [follow, setFollow] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // What memory already knows, shown before a run so the context is visible up front. The
  // glossary comes back with it: the acronyms are the same every week, so they are not retyped.
  const glossLoaded = useRef(false);
  useEffect(() => {
    fetch('/memory')
      .then((r) => r.json())
      .then((d) => {
        setPeople(d.people ?? []);
        if (d.glossary) setGloss(d.glossary);
      })
      .catch(() => {})
      .finally(() => {
        glossLoaded.current = true;
      });
  }, []);

  // Save edits back, but never before the load has landed - an empty box at startup is not the
  // operator clearing the glossary.
  useEffect(() => {
    if (!glossLoaded.current) return;
    const t = setTimeout(() => {
      fetch('/glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: gloss }),
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [gloss]);

  const chunksRef = useRef<Chunk[]>([]);
  const agentRef = useRef<Agent | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const t0 = useRef(0);
  const { toasts, push, dismiss } = useToasts();
  const note = useCallback((s: string, k: ToastKind = 'info') => push(s, k), [push]);

  const busy = phase === 'cleaning' || phase === 'agent' || phase === 'memo' || phase === 'learning';
  const started = phase !== 'idle';
  const finished = phase === 'done' || phase === 'stopped' || phase === 'error';

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((Date.now() - t0.current) / 1000), 500);
    return () => clearInterval(id);
  }, [busy]);

  /** Keeps state and the ref in step; every chunk mutation goes through here. */
  const putChunks = useCallback((fn: (cs: Chunk[]) => Chunk[]) => {
    chunksRef.current = fn(chunksRef.current);
    setChunks(chunksRef.current);
  }, []);

  /** Per-flag override, or clear one back to the model's own wording (text === null). */
  const onOverride = useCallback((id: number, text: string | null) => {
    setOverrides((o) => {
      if (text === null) {
        if (!(id in o)) return o;
        const next = { ...o };
        delete next[id];
        return next;
      }
      return { ...o, [id]: text };
    });
  }, []);

  /**
   * Chunks that never finished export as their original text, so nothing is silently dropped.
   * Done chunks are re-scanned with the same flag-id threading Transcript.tsx uses, so operator
   * overrides land on the exact spans shown on screen.
   */
  const cleaned = useCallback(() => {
    const st: ScanState = { para: 0, ts: '', flag: 0 };
    return chunksRef.current
      .map((c) => {
        const out = applyChunk(c.text, c.rawFlags, overrides, st, c.error);
        return c.done ? out : `[CHUNK NOT CLEANED]\n\n${c.orig}`;
      })
      .join('');
  }, [overrides]);

  function handle(ev: any) {
    switch (ev.type) {
      case 'start':
        putChunks(() =>
          ev.chunks.map((orig: string) => ({
            orig, ow: words(orig), text: '', done: false, error: '', rawFlags: [],
          })),
        );
        break;
      case 'delta':
        putChunks((cs) => cs.map((c, i) => (i === ev.n - 1 ? { ...c, text: c.text + ev.text } : c)));
        break;
      case 'retry':
        putChunks((cs) => cs.map((c, i) => (i === ev.n - 1 ? { ...c, text: '' } : c)));
        note(`Chunk ${ev.n} failed (${ev.error}). Retrying, attempt ${ev.attempt} of ${ev.of}.`, 'err');
        break;
      case 'chunk_end':
        putChunks((cs) =>
          cs.map((c, i) =>
            i === ev.n - 1 ? { ...c, text: ev.text, done: true, error: ev.error, rawFlags: ev.flags ?? [] } : c,
          ),
        );
        setTokens(ev.tokens);
        if (!ev.ok) note(`Chunk ${ev.n} failed after all retries (${ev.error}). Original kept.`, 'err');
        break;
      case 'done':
        setTokens(ev.tokens);
        setRunId(ev.run);
        note(
          `Saved to runs/${ev.run}` + (ev.failed.length ? `. Failed chunks: ${ev.failed.join(', ')}.` : '.'),
          ev.failed.length ? 'err' : 'ok',
        );
        break;
      case 'error':
        throw new Error(ev.message);

      case 'agent_start':
        setAgent({ summary: '', items: [], questions: [], log: [], done: false });
        break;
      case 'agent_call':
        setAgent((a) =>
          !a ? a : {
            ...a,
            summary: ev.name === 'set_summary' ? ev.args?.summary || '' : a.summary,
            log: [...a.log, [ev.name, ev.args?.title || ev.args?.question || 'recorded']],
          },
        );
        break;
      case 'agent_retry':
        note(`Agent call failed (${ev.error}). Retrying, attempt ${ev.attempt} of ${ev.of}.`, 'err');
        break;
      case 'agent_note':
        note(ev.message);
        break;
      case 'agent_end':
        setAgent((a) => {
          const next: Agent = {
            summary: ev.summary,
            done: true,
            log: a?.log ?? [],
            items: ev.items.map((i: Item) => ({ ...i, on: true })),
            questions: ev.questions.map((q: Question) => ({ ...q, on: true })),
          };
          agentRef.current = next;
          return next;
        });
        setTokens((t) => ({
          input: t.input + ev.tokens.input,
          output: t.output + ev.tokens.output,
        }));
        break;
      case 'agent_error':
        setAgent((a) => ({ ...(a ?? { summary: '', items: [], questions: [], log: [], done: true }), failed: ev.message, done: true }));
        note('Transcript cleaned and saved; only the agent pass failed. Press Re-run agent.', 'err');
        break;

      case 'memo_start':
        setMemo({ decisions: [], consequences: '', log: [], done: false });
        break;
      case 'memo_call':
        setMemo((m) =>
          !m ? m : {
            ...m,
            log: [...m.log, [ev.name, ev.args?.title || 'consequences recorded']],
          },
        );
        break;
      case 'memo_retry':
        note(`Thinking pass failed (${ev.error}). Retrying, attempt ${ev.attempt} of ${ev.of}.`, 'err');
        break;
      case 'memo_note':
        note(ev.message);
        break;
      case 'memo_end':
        setMemo((m) => ({
          decisions: ev.decisions,
          consequences: ev.consequences,
          log: m?.log ?? [],
          done: true,
        }));
        setTokens((t) => ({
          input: t.input + ev.tokens.input,
          output: t.output + ev.tokens.output,
        }));
        break;
      case 'memory_start':
        setLearnStats(null);
        break;
      case 'memory_end':
        setPeople(ev.people ?? []);
        setLearnStats(ev.stats);
        setTokens((t) => ({
          input: t.input + ev.tokens.input,
          output: t.output + ev.tokens.output,
        }));
        note(`Memory: ${ev.stats.added} new, ${ev.stats.updated} updated — ${ev.stats.total} people known.`, 'ok');
        break;
      case 'memory_error':
        note('Could not update memory: ' + ev.message, 'err');
        break;

      case 'memo_error':
        setMemo((m) => ({ ...(m ?? { decisions: [], consequences: '', log: [], done: true }), failed: ev.message, done: true }));
        note('The transcript and action items are saved; only the thinking pass failed.', 'err');
        break;
    }
  }

  async function start() {
    if (!text.trim()) return note('Load a file or paste some text first.', 'err');
    ctrl.current = new AbortController();
    t0.current = Date.now();
    setPhase('cleaning');
    putChunks(() => []); setAgent(null); setMemo(null); agentRef.current = null; setOverrides({});
    setRunId(''); setTokens(TOKENS0);
    setOpenInput(false); setFollow(true); setTab('transcript');
    let ok = false;
    try {
      await postStream('/clean', { text, glossary: gloss, filename }, ctrl.current.signal, handle);
      ok = true;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setPhase('stopped');
        note('Stopped. Finished chunks are saved in runs/.', 'err');
      } else {
        setPhase('error');
        note(e.message, 'err');
      }
    }
    if (ok) await (deepAnalysis ? runAgent() : runLearn());
  }

  /** The model drives this pass; nothing it proposes is written until Approve & save. */
  async function runAgent() {
    ctrl.current = new AbortController();
    setPhase('agent');
    setTab('actions');
    try {
      await postStream('/agent', { text: cleaned(), glossary: gloss }, ctrl.current.signal, handle);
    } catch (e: any) {
      setPhase(e.name === 'AbortError' ? 'stopped' : 'error');
      note(e.name === 'AbortError' ? 'Agent stopped. The cleaned transcript is saved.' : e.message, 'err');
      return;
    }
    await runMemo();
  }

  /** Stage three: reasons over the transcript and the items. Runs at high thinking effort. */
  async function runMemo() {
    const a = agentRef.current;
    ctrl.current = new AbortController();
    setPhase('memo');
    setTab('memo');
    try {
      await postStream(
        '/memo',
        {
          text: cleaned(),
          glossary: gloss,
          items: (a?.items ?? []).map(({ on, ...i }) => i),
          questions: (a?.questions ?? []).map(({ on, ...q }) => q),
        },
        ctrl.current.signal,
        handle,
      );
    } catch (e: any) {
      setPhase(e.name === 'AbortError' ? 'stopped' : 'error');
      note(e.name === 'AbortError' ? 'Thinking stopped. Everything else is saved.' : e.message, 'err');
      return;
    }
    await runLearn();
  }

  /** Stage four: records who was involved, so the next run starts with a roster. */
  async function runLearn() {
    const a = agentRef.current;
    ctrl.current = new AbortController();
    setPhase('learning');
    try {
      await postStream(
        '/learn',
        {
          text: cleaned(),
          glossary: gloss,
          run: runId,
          items: (a?.items ?? []).map(({ on, ...i }) => i),
        },
        ctrl.current.signal,
        handle,
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') note('Memory pass failed: ' + e.message, 'err');
    }
    setPhase('done');
  }

  async function forget(name: string) {
    try {
      const res = await fetch('/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      const d = await fetch('/memory').then((r) => r.json());
      setPeople(d.people ?? []);
      note(`Forgot ${name}.`, 'ok');
    } catch (e: any) {
      note('Could not forget: ' + e.message, 'err');
    }
  }

  // The roster is written by a model reading imperfect transcripts, and it feeds every later
  // run, so a wrong name has to be correctable without hand-editing memory/people.json.
  async function editPerson(name: string, patch: PersonEdit): Promise<boolean> {
    try {
      const res = await fetch('/person', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...patch }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      const d = await res.json();
      setPeople(d.people ?? []);
      note(
        patch.new_name.trim() === name ? `Updated ${name}.` : `${name} is now ${d.person.name}.`,
        'ok',
      );
      return true;
    } catch (e: any) {
      note('Could not save: ' + e.message, 'err');
      return false;
    }
  }

  // The memory pass only learns who a transcript names. Anyone else - the person who never
  // speaks, the stakeholder discussed in the third person - has to be entered by hand.
  async function addPerson(patch: PersonEdit): Promise<boolean> {
    try {
      const res = await fetch('/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: patch.new_name, org: patch.org, role: patch.role, note: patch.note,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      const d = await res.json();
      setPeople(d.people ?? []);
      note(`Added ${d.person.name}.`, 'ok');
      return true;
    } catch (e: any) {
      note('Could not add: ' + e.message, 'err');
      return false;
    }
  }

  async function approveMemo() {
    if (!memo || !runId) return note('This run was not saved, so there is nowhere to write to.', 'err');
    try {
      const res = await fetch('/commit-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run: runId, decisions: memo.decisions, consequences: memo.consequences }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || res.statusText);
      note(`Saved ${data.decisions} decision(s) to runs/${data.run}/memo.md and memo.json.`, 'ok');
    } catch (e: any) {
      note('Could not save: ' + e.message, 'err');
    }
  }

  const memoText = () => {
    if (!memo) return '';
    const L: string[] = ['DECISIONS REQUIRED', ''];
    memo.decisions.forEach((d: Decision, n) => {
      L.push(`${n + 1}. ${d.title}`);
      L.push(`   Recommend: ${d.recommend}`);
      L.push(`   Why: ${d.why}`);
      if (d.owner || d.by_when) L.push(`   ${[d.owner, d.by_when].filter(Boolean).join(' · ')}`);
      L.push('');
    });
    if (memo.consequences) L.push('IF NOTHING IS DONE', '', memo.consequences);
    return L.join('\n');
  };

  const approvedPayload = () => ({
    summary: agent?.summary ?? '',
    items: (agent?.items ?? []).filter((i) => i.on).map(({ on, ...i }) => i),
    questions: (agent?.questions ?? []).filter((q) => q.on).map(({ on, ...q }) => q),
  });

  async function approve() {
    if (!agent || !runId) return note('This run was not saved, so there is nowhere to write to.', 'err');
    try {
      const res = await fetch('/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run: runId, ...approvedPayload() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || res.statusText);
      note(`Saved ${data.items} item(s) and ${data.questions} question(s) to runs/${data.run}/.`, 'ok');
    } catch (e: any) {
      note('Could not save: ' + e.message, 'err');
    }
  }

  function toggle(kind: 'i' | 'q', n: number, on: boolean) {
    setAgent((a) =>
      !a ? a : kind === 'i'
        ? { ...a, items: a.items.map((x, i) => (i === n ? { ...x, on } : x)) }
        : { ...a, questions: a.questions.map((x, i) => (i === n ? { ...x, on } : x)) },
    );
  }

  const asText = () => {
    const a = approvedPayload(), L: string[] = [];
    if (a.summary) L.push('SUMMARY', '', a.summary, '');
    if (a.items.length) {
      L.push('ACTION ITEMS', '');
      for (const owner of [...new Set(a.items.map((i) => i.owner))]) {
        L.push(owner);
        for (const i of a.items.filter((x) => x.owner === owner)) {
          L.push(`  - ${i.title}${i.due ? ` (due ${i.due})` : ''}${i.blocking ? ' [blocks others]' : ''}`);
          if (i.detail) L.push(`    ${i.detail}`);
        }
        L.push('');
      }
    }
    if (a.questions.length) {
      L.push('OPEN QUESTIONS', '');
      for (const q of a.questions) L.push(`  - ${q.question}${q.raised_by ? ` (raised by ${q.raised_by})` : ''}`);
    }
    return L.join('\n');
  };

  function download(ext: string, type: string, body: string) {
    const a = Object.assign(document.createElement('a'), {
      download: (filename.replace(/\.[^.]+$/, '') || 'transcript') + '-cleaned.' + ext,
      href: URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` })),
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const done = chunks.filter((c) => c.done).length;
  const progress = chunks.length ? done / chunks.length : 0;
  const ready = !!agent?.done && !agent.failed && (agent.items.length > 0 || agent.questions.length > 0);
  const memoReady = !!memo?.done && !memo.failed && (memo.decisions.length > 0 || !!memo.consequences);
  const status =
    phase === 'cleaning' ? `Chunk ${Math.min(done + 1, chunks.length) || 1} of ${chunks.length || '…'}`
    : phase === 'agent' ? 'Agent working'
    : phase === 'memo' ? 'Thinking'
    : phase === 'learning' ? 'Remembering'
    : phase === 'done' ? `Done, ${chunks.length} chunks`
    : phase === 'stopped' ? `Stopped at chunk ${done} of ${chunks.length}`
    : phase === 'error' ? `Failed at chunk ${done} of ${chunks.length}`
    : '';

  return (
    <div className="mx-auto max-w-[105rem] px-6 pb-14">
      <header className="flex flex-wrap items-center gap-4 py-7">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
          <Waves size={19} />
        </span>
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">Transcript Cleanup</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-dim">
            <motion.span
              animate={{ opacity: [1, 0.35, 1] }}
              transition={{ duration: 2.4, repeat: Infinity }}
              className="h-1.5 w-1.5 rounded-full bg-good"
            />
            Runs locally · text goes only to the Google Gemini API
          </p>
        </div>
        <button
          onClick={() => setDark(!dark)}
          title={dark ? 'Switch to light' : 'Switch to dark'}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-surface text-dim shadow-xs transition-colors hover:text-ink"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={dark ? 'd' : 'l'}
              initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
              transition={{ duration: 0.18 }}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </motion.span>
          </AnimatePresence>
        </button>
      </header>

      <InputPanel
        text={text} setText={setText} gloss={gloss} setGloss={setGloss}
        filename={filename} setFilename={setFilename}
        deepAnalysis={deepAnalysis} setDeepAnalysis={setDeepAnalysis}
        busy={busy} open={openInput} setOpen={setOpenInput} known={people}
        onStart={start} onStop={() => ctrl.current?.abort()} onNote={note}
      />

      {!started && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 26 }}
          className="mt-4"
        >
          <Card
            title="People"
            right={
              <span className="text-[12px] text-dim">
                Context carried into every run · edit before you start
              </span>
            }
            className="max-h-[56vh]"
            bodyClass="overflow-auto"
          >
            <People
              people={people}
              learning={false}
              stats={null}
              onForget={forget}
              onEdit={editPerson}
              onAdd={addPerson}
            />
          </Card>
        </motion.div>
      )}

      <AnimatePresence>
        {started && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26 }}
            className="mt-4"
          >
            <Rail value={progress} active={busy} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Status" value={<span className="text-[15px]">{status}</span>} sub={runId ? `runs/${runId}` : undefined} />
              <Stat label="Tokens" value={<Ticker value={tokens.input + tokens.output} />} sub={`${num(tokens.input)} in · ${num(tokens.output)} out`} />
              <Stat label="Elapsed" value={clock(elapsed)} sub={chunks.length ? `${done}/${chunks.length} chunks` : undefined} />
              <Stat
                label="Proposed"
                value={agent?.done ? agent.items.length + agent.questions.length : '—'}
                sub={
                  agent?.done ? `${agent.items.length} actions · ${agent.questions.length} questions`
                  : finished ? 'not run this time'
                  : 'awaiting agent'
                }
              />
              <Stat
                label="Decisions"
                value={memo?.done ? memo.decisions.length : '—'}
                sub={
                  memo?.done ? 'reasoned at high effort'
                  : phase === 'memo' ? 'thinking…'
                  : finished ? 'not run this time'
                  : 'awaiting memo'
                }
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Tabs
                tabs={[
                  { id: 'actions', label: 'Action items', icon: <ListChecks size={15} />, badge: agent?.items.length },
                  { id: 'memo', label: 'Decision memo', icon: <Brain size={15} />, badge: memo?.decisions.length },
                  { id: 'transcript', label: 'Transcript', icon: <ScrollText size={15} /> },
                  { id: 'people', label: 'People', icon: <Users size={15} />, badge: people.length },
                ]}
                active={tab}
                onChange={setTab}
              />
              <div className="ml-auto flex flex-wrap gap-2">
                {tab === 'people' ? (
                  <Btn onClick={runLearn} disabled={busy || !chunks.some((c) => c.done)} tone="ghost">
                    <RefreshCw size={14} /> Re-read this meeting
                  </Btn>
                ) : tab === 'memo' ? (
                  <>
                    <Btn onClick={approveMemo} disabled={busy || !memoReady} tone="primary">
                      <Save size={14} /> Approve &amp; save
                    </Btn>
                    <CopyBtn text={memoText} label="Copy memo" disabled={busy || !memoReady} />
                    <Btn onClick={runMemo} disabled={busy || !agent?.done} tone="ghost">
                      <RefreshCw size={14} /> {memo ? 'Re-think' : 'Run decision memo'}
                    </Btn>
                  </>
                ) : tab === 'actions' ? (
                  <>
                    <Btn onClick={approve} disabled={busy || !ready} tone="primary">
                      <Save size={14} /> Approve &amp; save
                    </Btn>
                    <CopyBtn text={asText} label="Copy items" disabled={busy || !ready} />
                    <Btn onClick={runAgent} disabled={busy || !chunks.some((c) => c.done)} tone="ghost">
                      <RefreshCw size={14} /> {agent ? 'Re-run agent' : 'Run action items'}
                    </Btn>
                  </>
                ) : (
                  <>
                    <CopyBtn text={cleaned} label="Copy cleaned" disabled={busy || !done} />
                    <Btn onClick={() => download('md', 'text/markdown', cleaned())} disabled={busy || !done} tone="ghost">
                      .md
                    </Btn>
                    <Btn onClick={() => download('txt', 'text/plain', cleaned())} disabled={busy || !done} tone="ghost">
                      .txt
                    </Btn>
                  </>
                )}
              </div>
            </div>

            <div className="mt-3">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 10, filter: 'blur(5px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -8, filter: 'blur(5px)' }}
                  transition={{ duration: 0.22 }}
                >
                  {tab === 'people' ? (
                    <Card
                      title="People"
                      right={
                        <span className="text-[12px] text-dim">
                          Remembered across meetings · fed into every stage
                        </span>
                      }
                      className="h-[68vh] min-h-[26rem]"
                      bodyClass="overflow-auto"
                    >
                      <People
                        people={people}
                        learning={phase === 'learning'}
                        stats={learnStats}
                        onForget={forget}
                        onEdit={editPerson}
                        onAdd={addPerson}
                      />
                    </Card>
                  ) : tab === 'memo' ? (
                    <Card
                      title="Decision memo"
                      right={
                        <span className="text-[12px] text-dim">
                          {phase === 'memo'
                            ? 'Thinking at high effort…'
                            : memoReady
                              ? 'Judgement, not extraction — read it before you send it'
                              : ''}
                        </span>
                      }
                      className="h-[68vh] min-h-[26rem]"
                      bodyClass="overflow-auto"
                    >
                      <MemoPanel memo={memo} working={phase === 'memo'} finished={finished} agentDone={!!agent?.done} />
                    </Card>
                  ) : tab === 'actions' ? (
                    <Card
                      title="Action items"
                      right={
                        <span className="text-[12px] text-dim">
                          {phase === 'agent'
                            ? 'Agent working…'
                            : ready
                              ? 'Untick anything you don\u2019t want, then Approve & save'
                              : ''}
                        </span>
                      }
                      className="h-[68vh] min-h-[26rem]"
                      bodyClass="overflow-auto"
                    >
                      <ActionItems agent={agent} working={phase === 'agent'} onToggle={toggle} finished={finished} />
                    </Card>
                  ) : (
                    <Transcript
                      chunks={chunks}
                      running={phase === 'cleaning'}
                      follow={follow}
                      setFollow={setFollow}
                      overrides={overrides}
                      onOverride={onOverride}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ToastStack toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
