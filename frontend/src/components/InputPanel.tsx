import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, FileText, Play, Square, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Btn, SPRING } from './Bits';
import { num, words } from '../lib/scan';
import type { Person } from '../lib/types';

const SHOWN = 10;

const OK = ['.txt', '.md', '.vtt', '.srt', '.docx'];

export function InputPanel({
  text, setText, gloss, setGloss, filename, setFilename,
  busy, open, setOpen, known, onStart, onStop, onNote,
}: {
  text: string; setText: (s: string) => void;
  gloss: string; setGloss: (s: string) => void;
  filename: string; setFilename: (s: string) => void;
  busy: boolean; open: boolean; setOpen: (b: boolean) => void;
  known: Person[];
  onStart: () => void; onStop: () => void;
  onNote: (s: string, k?: 'info' | 'ok' | 'err') => void;
}) {
  const [over, setOver] = useState(false);
  const [loading, setLoading] = useState('');
  const loaded = useRef('');
  const fileRef = useRef<HTMLInputElement>(null);

  // A drop that misses the zone must not navigate away from the app.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    for (const t of ['dragover', 'drop']) window.addEventListener(t, stop as any);
    return () => {
      for (const t of ['dragover', 'drop']) window.removeEventListener(t, stop as any);
    };
  }, []);

  async function load(file?: File | null) {
    if (!file) return;
    if (file.size > 20e6) return onNote('That file is over 20 MB.', 'err');
    setLoading(file.name);
    try {
      const res = await fetch('/extract?name=' + encodeURIComponent(file.name), {
        method: 'POST', body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || res.statusText);
      setFilename(file.name);
      loaded.current = data.text;
      setText(data.text);
      onNote(`Loaded ${file.name} — ${num(words(data.text))} words.`, 'ok');
    } catch (e: any) {
      onNote('Could not load file: ' + e.message, 'err');
    } finally {
      setLoading('');
    }
  }

  const label = filename ? filename + (text === loaded.current ? '' : ' (edited)') : 'Pasted text';
  const field =
    'w-full resize-y rounded-lg border border-edge bg-sunken px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none transition-shadow placeholder:text-faint focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/10';

  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={SPRING} className="text-faint">
          <ChevronRight size={16} />
        </motion.span>
        <span className="text-[13px] font-semibold tracking-tight text-ink">Input</span>
        <span className="ml-auto text-[12.5px] text-dim">
          {text ? `${label} · ${num(words(text))} words` : 'No transcript loaded'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="grid gap-5 border-t border-edge p-5">
              <motion.div
                animate={over ? { scale: 1.008 } : { scale: 1 }}
                transition={SPRING}
                onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors ${
                  over ? 'border-brand bg-brand-soft' : 'border-edge bg-sunken hover:border-faint'
                }`}
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={loading || (over ? 'over' : 'idle')}
                    initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                    transition={SPRING}
                    className="flex flex-col items-center gap-2.5"
                  >
                    <motion.span
                      animate={over ? { y: [-2, -8, -2] } : { y: 0 }}
                      transition={{ duration: 1.1, repeat: over ? Infinity : 0 }}
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${
                        over ? 'bg-brand text-white' : 'bg-surface text-faint shadow-xs'
                      }`}
                    >
                      {loading ? <FileText size={19} /> : <Upload size={19} />}
                    </motion.span>
                    <span className="text-[13.5px] font-medium text-ink">
                      {loading ? `Reading ${loading}…` : over ? 'Release to load' : 'Drop a transcript, or click to choose'}
                    </span>
                    {!loading && !over && (
                      <span className="text-[12px] text-faint">{OK.join('  ·  ')}  ·  up to 20 MB</span>
                    )}
                  </motion.div>
                </AnimatePresence>
                <input
                  ref={fileRef} type="file" accept={OK.join(',')} className="hidden"
                  onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }}
                />
              </motion.div>

              <Field label="Or paste text">
                <textarea
                  value={text} spellCheck={false} placeholder="Paste transcript text here"
                  onChange={(e) => { setText(e.target.value); if (!e.target.value) setFilename(''); }}
                  className={`${field} min-h-[10rem] font-mono`}
                />
              </Field>

              <Field
                label="Glossary"
                hint="Acronyms, product names, and anyone memory has not met — one per line. Kept for next time."
              >
                {/* The roster is already prepended server-side, so listing these again would
                    only spend tokens saying the same thing twice. */}
                {known.length > 0 && (
                  <div className="-mb-0.5 flex flex-wrap items-center gap-1.5">
                    {known.slice(0, SHOWN).map((p) => (
                      <span
                        key={p.name}
                        title={
                          p.aliases.length
                            ? `also heard as ${p.aliases.join(', ')}`
                            : 'known from previous meetings'
                        }
                        className="rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] font-medium text-brand"
                      >
                        {p.name}
                      </span>
                    ))}
                    {known.length > SHOWN && (
                      <span className="text-[11.5px] text-faint">+{known.length - SHOWN} more</span>
                    )}
                    <span className="text-[11.5px] text-faint">
                      already remembered — added for you, no need to retype.
                    </span>
                  </div>
                )}
                <textarea
                  value={gloss} spellCheck={false}
                  placeholder={'COIN\nERI@N\nPINE Lab'}
                  onChange={(e) => setGloss(e.target.value)}
                  className={`${field} min-h-[5.5rem] font-mono`}
                />
              </Field>

              <div className="flex gap-2.5">
                <Btn onClick={onStart} disabled={busy || !text.trim()} tone="primary">
                  <Play size={14} /> Clean transcript
                </Btn>
                {busy && (
                  <Btn onClick={onStop} tone="danger">
                    <Square size={12} /> Stop
                  </Btn>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-[13px] font-semibold tracking-tight text-ink">
        {label}
        {hint && <span className="ml-2 font-normal text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
