import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// The registry's dominant spring: stiffness 300 / damping 30.
export const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

export function Card({
  title,
  right,
  children,
  className = '',
  bodyClass = '',
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-sm ${className}`}
    >
      {title !== undefined && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-3.5">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  tone = 'plain',
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'primary' | 'ghost' | 'danger';
  className?: string;
  title?: string;
}) {
  const tones = {
    plain:
      'border border-edge bg-surface text-ink shadow-xs hover:bg-sunken',
    primary:
      'border border-transparent bg-brand text-white shadow-sm hover:brightness-110',
    ghost: 'border border-transparent text-dim hover:bg-sunken hover:text-ink',
    danger:
      'border border-edge bg-surface text-warn shadow-xs hover:bg-warn/10',
  }[tone];
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={SPRING}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${tones} ${className}`}
    >
      {children}
    </motion.button>
  );
}

/** From `copy-confirm`: the icon and label cross-fade through a blur into a checkmark. */
export function CopyBtn({
  text,
  label = 'Copy',
  disabled,
}: {
  text: () => string;
  label?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setState('ok');
    } catch {
      setState('fail');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1400);
  };

  return (
    <Btn onClick={go} disabled={disabled}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, scale: 0.7, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.7, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 400, damping: 26 }}
          className="inline-flex items-center gap-2"
        >
          {state === 'ok' ? (
            <Check size={14} className="text-good" />
          ) : (
            <Copy size={14} className="text-faint" />
          )}
          {state === 'ok' ? 'Copied' : state === 'fail' ? 'Failed' : label}
        </motion.span>
      </AnimatePresence>
    </Btn>
  );
}

/** Counts toward `value` so totals tick rather than jump. */
export function Ticker({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 420);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString()}</>;
}

/** Dashboard-style metric tile. */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface px-4 py-3 shadow-xs">
      <div className="text-[11px] font-medium tracking-wide text-faint uppercase">{label}</div>
      <div className="mt-1 text-[19px] font-semibold tracking-tight tabular-nums text-ink">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11.5px] text-dim">{sub}</div>}
    </div>
  );
}

/** Rounded rail with a travelling sheen, from `labeled-progress-indicator`. */
export function Rail({ value, active }: { value: number; active: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-sunken shadow-inner">
      <motion.div
        animate={{ width: `${Math.round(value * 100)}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 24 }}
        className="relative h-full overflow-hidden rounded-full bg-brand"
      >
        {active && (
          <motion.div
            animate={{ x: ['-100%', '260%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/55 to-transparent"
          />
        )}
      </motion.div>
    </div>
  );
}

export function Pill({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'warn' | 'brand' | 'good';
}) {
  const t = {
    plain: 'bg-sunken text-dim',
    warn: 'bg-warn/12 text-warn',
    brand: 'bg-brand-soft text-brand',
    good: 'bg-good/12 text-good',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${t}`}
    >
      {children}
    </span>
  );
}
