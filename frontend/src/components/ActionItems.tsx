import { AnimatePresence, motion } from 'motion/react';
import { Check, CircleAlert, HelpCircle, Zap } from 'lucide-react';
import { Pill, SPRING } from './Bits';
import type { Agent } from '../lib/types';

// The agent's proposals as a checklist you approve. Items stagger in as the tool calls land,
// which is the point of doing this in React: the list is derived state, not re-rendered HTML.
export function ActionItems({
  agent,
  working,
  onToggle,
  finished,
}: {
  agent: Agent | null;
  working: boolean;
  onToggle: (kind: 'i' | 'q', n: number, on: boolean) => void;
  finished: boolean;
}) {
  if (!agent) {
    return (
      <Empty>
        {finished
          ? 'Off by default for this run — press Run action items above to extract them now.'
          : 'Waiting for the corrected transcript…'}
      </Empty>
    );
  }
  if (agent.failed) {
    return (
      <div className="m-5 flex items-start gap-3 rounded-lg border border-warn/30 bg-warn/8 px-4 py-3.5">
        <CircleAlert size={17} className="mt-px shrink-0 text-warn" />
        <p className="text-[13px] leading-relaxed text-ink">
          <span className="font-semibold">The agent pass failed.</span> {agent.failed}
          <span className="mt-1 block text-dim">
            The transcript is cleaned and saved — press Re-run agent to try again.
          </span>
        </p>
      </div>
    );
  }

  const owners = [...new Set(agent.items.map((i) => i.owner))];
  const nothing = agent.done && !agent.items.length && !agent.questions.length;

  return (
    <div className="space-y-8 p-6">
      <AnimatePresence>
        {working && agent.log.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-lg border border-edge bg-sunken px-4 py-3"
          >
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="h-1.5 w-1.5 rounded-full bg-brand"
              />
              Agent working
            </div>
            <AnimatePresence initial={false}>
              {agent.log.map(([tool, what], n) => (
                <motion.div
                  key={`${n}-${tool}`}
                  initial={{ opacity: 0, x: -10, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  transition={SPRING}
                  className="flex gap-2.5 py-1 font-mono text-[12px] text-dim"
                >
                  <span className="text-brand">{tool}</span>
                  <span className="truncate">{what}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {agent.summary && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
          <H>Summary</H>
          <p className="text-[14.5px] leading-[1.7] text-ink">{agent.summary}</p>
        </motion.section>
      )}

      {agent.items.length > 0 && (
        <section>
          <H>Action items</H>
          <div className="space-y-6">
            {owners.map((owner) => (
              <div key={owner}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
                    {owner.slice(0, 1).toUpperCase()}
                  </span>
                  <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">{owner}</h3>
                </div>
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {agent.items.map((it, n) =>
                      it.owner !== owner ? null : (
                        <motion.li
                          key={`${n}-${it.title}`}
                          layout
                          initial={{ opacity: 0, y: 14, filter: 'blur(5px)' }}
                          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                          transition={{ ...SPRING, delay: Math.min(n * 0.05, 0.4) }}
                          whileHover={{ y: -2 }}
                          className={`rounded-xl border bg-surface px-4 py-3.5 shadow-xs transition-all hover:shadow-sm ${
                            it.blocking ? 'border-brand/40' : 'border-edge'
                          } ${it.on ? '' : 'opacity-45'}`}
                        >
                          <Tick on={it.on} onChange={(v) => onToggle('i', n, v)}>
                            {it.title}
                          </Tick>
                          {(it.due || it.blocking) && (
                            <div className="mt-2 ml-8 flex flex-wrap gap-2">
                              {it.due && <Pill tone="warn">Due {it.due}</Pill>}
                              {it.blocking && (
                                <Pill tone="brand">
                                  <Zap size={10} /> Blocks others
                                </Pill>
                              )}
                            </div>
                          )}
                          {it.detail && (
                            <p className="mt-2 ml-8 text-[13.5px] leading-relaxed text-dim">{it.detail}</p>
                          )}
                          {it.source_quote && (
                            <blockquote className="mt-2.5 ml-8 rounded-r-md border-l-2 border-edge bg-sunken px-3 py-2 font-mono text-[12px] leading-relaxed text-faint">
                              “{it.source_quote}”
                            </blockquote>
                          )}
                        </motion.li>
                      ),
                    )}
                  </AnimatePresence>
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {agent.questions.length > 0 && (
        <section>
          <H>Open questions</H>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {agent.questions.map((q, n) => (
                <motion.li
                  key={`${n}-${q.question}`}
                  layout
                  initial={{ opacity: 0, y: 14, filter: 'blur(5px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ ...SPRING, delay: Math.min(n * 0.05, 0.4) }}
                  whileHover={{ y: -2 }}
                  className={`rounded-xl border border-edge bg-surface px-4 py-3.5 shadow-xs transition-all hover:shadow-sm ${
                    q.on ? '' : 'opacity-45'
                  }`}
                >
                  <Tick on={q.on} onChange={(v) => onToggle('q', n, v)} icon={<HelpCircle size={13} />}>
                    {q.question}
                  </Tick>
                  {q.raised_by && (
                    <div className="mt-2 ml-8">
                      <Pill>Raised by {q.raised_by}</Pill>
                    </div>
                  )}
                  {q.why_open && (
                    <p className="mt-2 ml-8 text-[13.5px] leading-relaxed text-dim">{q.why_open}</p>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}

      {nothing && <Empty>The agent found no action items in this transcript.</Empty>}
      {!agent.done && !agent.summary && agent.log.length === 0 && (
        <Empty>Reading the transcript…</Empty>
      )}
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
      {children}
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-[13.5px] text-dim">{children}</p>;
}

/** Checkbox with a spring-scaled tick, so including or excluding an item reads as a decision. */
function Tick({
  on, onChange, children, icon,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        role="checkbox"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
          on ? 'border-brand bg-brand text-white' : 'border-edge bg-surface hover:border-faint'
        }`}
      >
        <AnimatePresence>
          {on && (
            <motion.span
              initial={{ scale: 0, rotate: -25 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            >
              <Check size={12} strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <span className="flex items-start gap-2 text-[14px] leading-snug font-semibold tracking-tight text-ink">
        {icon && <span className="mt-0.5 shrink-0 text-faint">{icon}</span>}
        {children}
      </span>
    </div>
  );
}
