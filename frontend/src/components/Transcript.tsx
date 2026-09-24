import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import { Card, Pill } from './Bits';
import { scan, words } from '../lib/scan';
import type { Chunk, Flag, ScanState } from '../lib/types';

/**
 * Original / cleaned panes with scroll sync, and the flags list.
 * ponytail: chunk-level scroll anchors, as in the previous build; drifts within a long chunk
 * if the edits are uneven. Anchor per paragraph if that becomes annoying.
 */
export function Transcript({
  chunks,
  running,
  follow,
  setFollow,
  overrides,
  onOverride,
}: {
  chunks: Chunk[];
  running: boolean;
  follow: boolean;
  setFollow: (b: boolean) => void;
  overrides: Record<number, string>;
  onOverride: (id: number, text: string | null) => void;
}) {
  const L = useRef<HTMLDivElement>(null);
  const R = useRef<HTMLDivElement>(null);
  const ours = useRef(new Set<Element>());

  // Recompute flags per chunk, threading paragraph/flag counters through in order.
  const st: ScanState = { para: 0, ts: '', flag: 0 };
  const scanned = chunks.map((c) => {
    const r = scan(c.text, c.rawFlags, st, c.error);
    return { ...r, chunk: c };
  });
  const flags: Flag[] = scanned.flatMap((s) => s.flags);
  const flagsById = new Map(flags.map((f) => [f.id, f]));

  useEffect(() => {
    if (!running || !follow || !R.current) return;
    R.current.scrollTop = R.current.scrollHeight;
  }, [chunks, running, follow]);

  function setScroll(pane: HTMLDivElement, top: number) {
    const before = pane.scrollTop;
    pane.scrollTop = top;
    if (pane.scrollTop !== before) ours.current.add(pane);
  }
  const share = (i: number) => {
    const c = chunks[i];
    return c.done ? 1 : Math.max(0.001, Math.min(1, words(c.text) / (c.ow || 1)));
  };
  function map(from: HTMLDivElement, to: HTMLDivElement) {
    const A = from.children, B = to.children;
    if (!A.length || A.length !== B.length) return;
    let i = 0;
    while (i + 1 < A.length && (A[i + 1] as HTMLElement).offsetTop <= from.scrollTop) i++;
    const a = A[i] as HTMLElement, b = B[i] as HTMLElement;
    const f = (from.scrollTop - a.offsetTop) / (a.offsetHeight || 1);
    const s = share(i);
    const t = from === R.current ? f * s : f;
    setScroll(to, b.offsetTop + (to === R.current ? Math.min(1, t / s) : t) * b.offsetHeight);
  }
  function onScroll(self: HTMLDivElement | null, other: HTMLDivElement | null) {
    if (!self || !other) return;
    if (ours.current.delete(self)) return;
    if (self === R.current) {
      setFollow(self.scrollHeight - self.scrollTop - self.clientHeight < 40);
    }
    map(self, other);
  }

  function jump(id: number) {
    setFollow(false);
    const el = document.getElementById(`f${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.animate(
      [
        { boxShadow: '0 0 0 0 rgba(99,102,241,0)' },
        { boxShadow: '0 0 0 4px rgba(99,102,241,0.35)' },
        { boxShadow: '0 0 0 0 rgba(99,102,241,0)' },
      ],
      { duration: 1400, easing: 'ease-out' },
    );
  }

  const pane =
    'h-full overflow-auto p-5 font-mono text-[13px] leading-[1.85] whitespace-pre-wrap [overflow-wrap:anywhere]';

  return (
    <div className="grid h-[68vh] min-h-[26rem] grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_21rem]">
      <Card title="Original" bodyClass="min-h-0">
        <div ref={L} onScroll={() => onScroll(L.current, R.current)} className={`${pane} text-dim`}>
          {chunks.map((c, i) => (
            <div key={i} className={i ? 'mt-5 border-t border-dashed border-edge pt-5' : ''}>
              {c.orig.trimEnd()}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Cleaned" bodyClass="min-h-0">
        <div ref={R} onScroll={() => onScroll(R.current, L.current)} className={pane}>
          {scanned.map(({ segs, chunk }, i) => (
            <div key={i} className={i ? 'mt-5 border-t border-dashed border-edge pt-5' : ''}>
              {!chunk.text && !chunk.done ? (
                <Waiting active={running && i === chunks.findIndex((x) => !x.done)} />
              ) : (
                segs.map((s, k) =>
                  s.flagId === null ? (
                    <span key={k}>{s.text}</span>
                  ) : (
                    <FlagSpan
                      key={s.flagId}
                      id={s.flagId}
                      text={s.text}
                      fail={s.fail}
                      editable={chunk.done && !s.fail}
                      original={flagsById.get(s.flagId)?.original ?? ''}
                      override={overrides[s.flagId]}
                      onOverride={onOverride}
                    />
                  ),
                )
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Flags"
        right={
          <span className="rounded-full bg-sunken px-2 py-0.5 text-[11.5px] font-semibold text-dim">
            {flags.length}
          </span>
        }
        bodyClass="min-h-0"
      >
        <ol className="h-full overflow-auto">
          {flags.length === 0 && (
            <li className="p-5 text-[13px] text-dim">No flags — nothing needed checking.</li>
          )}
          {flags.map((f) =>
            f.located ? (
              <li key={f.id}>
                <motion.button
                  whileHover={{ x: 3 }}
                  onClick={() => jump(f.id)}
                  className="grid w-full gap-1.5 border-b border-edge px-4 py-3.5 text-left transition-colors hover:bg-sunken"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">
                      {f.fail ? '⚠ ' : ''}¶{f.para}
                      {f.ts ? ` · ${f.ts}` : ''}
                    </span>
                    {overrides[f.id] !== undefined && <Pill tone="good">Edited</Pill>}
                  </span>
                  <span className="truncate font-mono text-[11.5px] text-faint">…{f.before}</span>
                  {f.original && !f.fail && (
                    <span className="truncate text-[11.5px] text-faint">heard: “{f.original}”</span>
                  )}
                  <span className="text-[13px] leading-snug text-ink">{f.why}</span>
                </motion.button>
              </li>
            ) : (
              <li key={f.id} className="grid gap-1.5 border-b border-edge px-4 py-3.5">
                <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">
                  Not located in output
                </span>
                {f.original && (
                  <span className="truncate text-[11.5px] text-faint">heard: “{f.original}”</span>
                )}
                <span className="text-[13px] leading-snug text-ink">{f.why}</span>
              </li>
            ),
          )}
        </ol>
      </Card>
    </div>
  );
}

/**
 * A flagged span in the Cleaned pane. Accepted (the model's own wording) by default; click the
 * text to type a replacement, or use the small "original" button to fall back to what was
 * actually said. Only rendered interactive once the owning chunk is `done` - no editing text
 * that's still streaming in. Committing an empty value, or the model's own text again, clears
 * the override rather than storing a no-op.
 */
function FlagSpan({
  id,
  text,
  original,
  fail,
  editable,
  override,
  onOverride,
}: {
  id: number;
  text: string;
  original: string;
  fail: boolean;
  editable: boolean;
  override: string | undefined;
  onOverride: (id: number, text: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const display = override ?? text;
  const overridden = override !== undefined;

  const markClass = `rounded px-1 py-px font-medium ${
    fail ? 'bg-warn/15 text-warn' : overridden ? 'bg-good/15 text-good' : 'bg-brand-soft text-brand'
  }`;

  if (!editable) {
    return (
      <mark id={`f${id}`} className={markClass}>
        {display}
      </mark>
    );
  }

  function commit(v: string) {
    setEditing(false);
    const t = v.trim();
    if (!t || t === text) onOverride(id, null);
    else onOverride(id, v);
  }

  return (
    <mark id={`f${id}`} className={`group/flag ${markClass}`}>
      {editing ? (
        <input
          autoFocus
          defaultValue={display}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          size={Math.max(display.length, 3)}
          className="max-w-full rounded border border-brand/50 bg-surface px-1 font-mono text-[13px] text-ink outline-none"
        />
      ) : (
        <span onClick={() => setEditing(true)} className="cursor-text" title="Click to edit">
          {display}
        </span>
      )}
      {!editing && (
        <span className="ml-1 inline-flex items-center gap-0.5 align-middle opacity-0 transition-opacity group-hover/flag:opacity-100 focus-within:opacity-100">
          {original && display !== original && (
            <button
              type="button"
              onClick={() => onOverride(id, original)}
              title={`Use original: "${original}"`}
              className="rounded text-dim hover:text-ink"
            >
              <Undo2 size={11} />
            </button>
          )}
          {overridden && (
            <button
              type="button"
              onClick={() => onOverride(id, null)}
              title="Revert to model's wording"
              className="rounded text-dim hover:text-ink"
            >
              <X size={11} />
            </button>
          )}
        </span>
      )}
    </mark>
  );
}

function Waiting({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-sunken px-3 py-1 text-[11.5px] font-medium text-dim">
      {active ? (
        <>
          <motion.span
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 1.15, repeat: Infinity }}
            className="h-1.5 w-1.5 rounded-full bg-brand"
          />
          Cleaning…
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-faint" />
          Queued
        </>
      )}
    </span>
  );
}
