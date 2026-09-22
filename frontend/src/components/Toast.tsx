import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

// From `inline-toast`: spring entry, blur morph, and a timer bar that wipes as it ages out.
export type ToastKind = 'info' | 'ok' | 'err';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  ms: number;
}

const ICON = {
  info: <Info size={16} className="text-brand" />,
  ok: <CheckCircle2 size={16} className="text-good" />,
  err: <AlertTriangle size={16} className="text-warn" />,
};

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (text: string, kind: ToastKind = 'info', ms = kind === 'err' ? 9000 : 5000) => {
      if (!text) return;
      const id = next.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, text, ms }]);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function ToastStack({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-[min(28rem,calc(100vw-3rem))] flex-col gap-2.5">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 18, scale: 0.96, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: 28, scale: 0.96, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="pointer-events-auto relative overflow-hidden rounded-xl border border-edge bg-surface/95 shadow-lg backdrop-blur"
          >
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="mt-px shrink-0">{ICON[t.kind]}</span>
              <span className="flex-1 text-[13px] leading-relaxed text-ink">{t.text}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="-mt-0.5 -mr-1 shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-sunken hover:text-ink"
              >
                <X size={13} />
              </button>
            </div>
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: t.ms / 1000, ease: 'linear' }}
              className={`absolute inset-x-0 bottom-0 h-0.5 origin-left ${
                t.kind === 'err' ? 'bg-warn' : t.kind === 'ok' ? 'bg-good' : 'bg-brand'
              }`}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
