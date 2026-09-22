import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, Brain, CircleAlert, Clock, Lock, User } from 'lucide-react';
import { Pill, SPRING } from './Bits';
import type { Memo } from '../lib/types';

// Stage three. Unlike the action items, nothing here is a checklist: a decision memo is read,
// not ticked, so the whole thing is approved or not.
export function MemoPanel({ memo, working }: { memo: Memo | null; working: boolean }) {
  if (!memo) return <Empty>Waiting for the action items…</Empty>;
  if (memo.failed) {
    return (
      <div className="m-5 flex items-start gap-3 rounded-lg border border-warn/30 bg-warn/8 px-4 py-3.5">
        <CircleAlert size={17} className="mt-px shrink-0 text-warn" />
        <p className="text-[13px] leading-relaxed text-ink">
          <span className="font-semibold">The thinking pass failed.</span> {memo.failed}
          <span className="mt-1 block text-dim">
            Everything else is saved — press Re-think to try again.
          </span>
        </p>
      </div>
    );
  }

  const empty = memo.done && !memo.decisions.length && !memo.consequences;

  return (
    <div className="space-y-8 p-6">
      <AnimatePresence>
        {working && (
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
                className="flex items-center gap-1.5 text-brand"
              >
                <Brain size={12} /> Thinking
              </motion.span>
              <span className="normal-case text-faint">
                reasoning over the transcript and the extracted items
              </span>
            </div>
            <AnimatePresence initial={false}>
              {memo.log.map(([tool, what], n) => (
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
            {memo.log.length === 0 && (
              <div className="py-1 font-mono text-[12px] text-faint">
                This pass runs at high thinking effort — it takes longer than the others.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {memo.decisions.length > 0 && (
        <section>
          <H>Decisions required</H>
          <ol className="space-y-3">
            <AnimatePresence initial={false}>
              {memo.decisions.map((d, n) => (
                <motion.li
                  key={`${n}-${d.title}`}
                  layout
                  initial={{ opacity: 0, y: 14, filter: 'blur(5px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ ...SPRING, delay: Math.min(n * 0.07, 0.4) }}
                  whileHover={{ y: -2 }}
                  className="rounded-xl border border-edge bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11.5px] font-bold text-white">
                      {n + 1}
                    </span>
                    <h3 className="text-[14.5px] leading-snug font-semibold tracking-tight text-ink">
                      {d.title}
                    </h3>
                  </div>

                  <div className="mt-3 ml-9 space-y-2.5">
                    <div className="flex gap-2.5 rounded-lg bg-brand-soft px-3 py-2.5">
                      <ArrowRight size={15} className="mt-0.5 shrink-0 text-brand" />
                      <p className="text-[13.5px] leading-relaxed text-ink">
                        <span className="font-semibold text-brand">Recommend: </span>
                        {d.recommend}
                      </p>
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-dim">{d.why}</p>
                    {(d.owner || d.by_when || d.blocks) && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {d.owner && (
                          <Pill>
                            <User size={10} /> {d.owner}
                          </Pill>
                        )}
                        {d.by_when && (
                          <Pill tone="warn">
                            <Clock size={10} /> {d.by_when}
                          </Pill>
                        )}
                        {d.blocks && (
                          <Pill tone="brand">
                            <Lock size={10} /> Blocks downstream work
                          </Pill>
                        )}
                      </div>
                    )}
                    {d.blocks && (
                      <p className="text-[12.5px] leading-relaxed text-faint">
                        <span className="font-medium">Blocks:</span> {d.blocks}
                      </p>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </section>
      )}

      {memo.consequences && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
          <H>If nothing is done</H>
          <div className="flex gap-3 rounded-xl border border-warn/25 bg-warn/6 px-4 py-3.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-[13.5px] leading-[1.7] text-ink">{memo.consequences}</p>
          </div>
        </motion.section>
      )}

      {empty && <Empty>The thinking agent found no decisions to surface.</Empty>}
      {!memo.done && !working && <Empty>Waiting…</Empty>}
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
