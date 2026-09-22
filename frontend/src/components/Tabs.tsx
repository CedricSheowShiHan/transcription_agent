import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// From Watermelon's `fluid-tabs`: a rounded-full track, a layoutId pill that springs between
// tabs, and the label blurring through the swap.
export interface TabItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative inline-flex items-center gap-1 rounded-full border border-edge bg-sunken p-1">
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="group relative rounded-full px-4 py-2 outline-none"
          >
            {on && (
              <motion.div
                layoutId="tab-pill"
                transition={{ type: 'spring', stiffness: 280, damping: 25, mass: 0.8 }}
                className="absolute inset-0 rounded-full border border-edge bg-surface shadow-sm"
              />
            )}
            <motion.span
              transition={{ duration: 0.3, ease: 'easeOut' }}
              animate={{ filter: on ? ['blur(0px)', 'blur(4px)', 'blur(0px)'] : 'blur(0px)' }}
              className={`relative z-10 flex items-center gap-2 text-[13px] tracking-tight whitespace-nowrap transition-colors ${
                on ? 'font-semibold text-ink' : 'font-medium text-dim group-hover:text-ink'
              }`}
            >
              <motion.span
                animate={{ scale: on ? 1.05 : 1 }}
                transition={{ scale: { type: 'spring', stiffness: 300, damping: 15 } }}
                className={`flex shrink-0 items-center ${on ? 'text-brand' : 'text-faint'}`}
              >
                {tab.icon}
              </motion.span>
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10.5px] leading-none font-semibold ${
                    on ? 'bg-brand-soft text-brand' : 'bg-surface text-faint'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}
