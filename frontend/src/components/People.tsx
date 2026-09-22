import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Building2, Check, CircleAlert, Pencil, Pin, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { Btn, Pill, SPRING } from './Bits';
import type { Person, PersonEdit } from '../lib/types';

const EMPTY: PersonEdit = { new_name: '', org: '', role: '', note: '', aliases: [] };

// Memory feeds later runs, so a wrong entry compounds. Everything here is visible, every row can
// be corrected by hand, and every row can be removed - that is the point of showing it rather
// than keeping it in a file. People can also be added before any transcript names them: the
// memory pass only ever learns who was spoken about.
export function People({
  people,
  learning,
  stats,
  onForget,
  onEdit,
  onAdd,
}: {
  people: Person[];
  learning: boolean;
  stats: { added: number; updated: number } | null;
  onForget: (name: string) => void;
  onEdit: (name: string, patch: PersonEdit) => Promise<boolean>;
  onAdd: (patch: PersonEdit) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-dim">
        <span className="min-w-0 flex-1">
          {people.length > 0 ? (
            <>
              <span className="font-semibold text-ink">{people.length}</span> people — their role
              and description are fed into every stage of the next run.
            </>
          ) : learning ? (
            'Reading the transcript for people…'
          ) : (
            'Nobody yet. Add the people you meet with, or run a transcript and they are recorded automatically.'
          )}
        </span>
        {learning && (
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="text-brand"
          >
            learning…
          </motion.span>
        )}
        {stats && !learning && (
          <Pill tone="good">
            +{stats.added} new · {stats.updated} updated
          </Pill>
        )}
        {!adding && (
          <Btn onClick={() => setAdding(true)} tone="plain">
            <Plus size={14} /> Add person
          </Btn>
        )}
      </div>

      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {adding && (
            <motion.li
              key="__new"
              layout
              initial={{ opacity: 0, y: -10, filter: 'blur(5px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(5px)' }}
              transition={SPRING}
              className="rounded-xl border border-brand/40 bg-surface px-4 py-3.5 shadow-xs ring-4 ring-brand/8"
            >
              <div className="flex items-start gap-3">
                <span className="mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <UserPlus size={14} />
                </span>
                <Editor
                  start={EMPTY}
                  isNew
                  onSave={onAdd}
                  onCancel={() => setAdding(false)}
                  onDone={() => setAdding(false)}
                />
              </div>
            </motion.li>
          )}

          {people.map((p, n) => (
            <Row key={p.name} p={p} n={n} onForget={onForget} onEdit={onEdit} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function Row({
  p,
  n,
  onForget,
  onEdit,
}: {
  p: Person;
  n: number;
  onForget: (name: string) => void;
  onEdit: (name: string, patch: PersonEdit) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const initial = p.name.replace(/^(prof|dr|mr|mrs|ms)\.?\s*/i, '').slice(0, 1).toUpperCase();

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12, filter: 'blur(5px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: -20, filter: 'blur(5px)' }}
      transition={{ ...SPRING, delay: Math.min(n * 0.04, 0.3) }}
      whileHover={editing ? undefined : { y: -2 }}
      className={`group rounded-xl border bg-surface px-4 py-3.5 shadow-xs transition-shadow ${
        editing ? 'border-brand/40 ring-4 ring-brand/8' : 'border-edge hover:shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-bold text-brand">
          {initial}
        </span>

        {editing ? (
          <Editor
            start={draftOf(p)}
            onSave={(patch) => onEdit(p.name, patch)}
            onCancel={() => setEditing(false)}
            onDone={() => setEditing(false)}
          />
        ) : (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h3 className="text-[14px] font-semibold tracking-tight text-ink">{p.name}</h3>
              {p.pinned && (
                <span title="Written by hand — later runs will not rename this person.">
                  <Pin size={11} className="text-brand" />
                </span>
              )}
              {p.role && <span className="text-[12.5px] text-dim">{p.role}</span>}
              <span className="ml-auto text-[11.5px] text-faint">
                {p.meetings === 0
                  ? 'added by hand'
                  : `${p.meetings} ${p.meetings === 1 ? 'meeting' : 'meetings'}`}
              </span>
            </div>

            {(p.org || p.aliases.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {p.org && (
                  <Pill>
                    <Building2 size={10} /> {p.org}
                  </Pill>
                )}
                {p.aliases.length > 0 && (
                  <Pill tone="warn">
                    <CircleAlert size={10} /> also heard as {p.aliases.join(', ')}
                  </Pill>
                )}
              </div>
            )}

            {p.notes.length > 0 && (
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                {p.notes[p.notes.length - 1]}
              </p>
            )}
          </div>
        )}

        {!editing && (
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              onClick={() => setEditing(true)}
              title={`Edit ${p.name}`}
              className="rounded-md p-1.5 text-faint transition-colors hover:bg-brand-soft hover:text-brand"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => onForget(p.name)}
              title={`Forget ${p.name}`}
              className="rounded-md p-1.5 text-faint transition-colors hover:bg-warn/10 hover:text-warn"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </motion.li>
  );
}

// The same form adds and corrects; only the button label and the alias chips differ.
function Editor({
  start,
  isNew,
  onSave,
  onCancel,
  onDone,
}: {
  start: PersonEdit;
  isNew?: boolean;
  onSave: (patch: PersonEdit) => Promise<boolean>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<PersonEdit>(start);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) onDone();
  }

  const aliases = draft.aliases ?? [];

  return (
    <div
      className="min-w-0 flex-1"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) save();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Field
          value={draft.new_name}
          onChange={(v) => setDraft({ ...draft, new_name: v })}
          placeholder="Name"
          className="min-w-[11rem] flex-1 font-semibold"
          autoFocus
        />
        <Field
          value={draft.role ?? ''}
          onChange={(v) => setDraft({ ...draft, role: v })}
          placeholder="Role — what they do"
          className="min-w-[10rem] flex-1"
        />
        <Field
          value={draft.org ?? ''}
          onChange={(v) => setDraft({ ...draft, org: v })}
          placeholder="Org"
          className="w-32"
        />
      </div>

      {aliases.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] text-faint">Also heard as</span>
          {aliases.map((a) => (
            <span
              key={a}
              className="inline-flex items-center gap-1 rounded-full bg-warn/12 py-1 pr-1.5 pl-2.5 text-[11.5px] font-medium text-warn"
            >
              {a}
              <button
                onClick={() => setDraft({ ...draft, aliases: aliases.filter((x) => x !== a) })}
                title={`Not the same person as ${a}`}
                className="rounded-full p-0.5 hover:bg-warn/20"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <Field
        value={draft.note ?? ''}
        onChange={(v) => setDraft({ ...draft, note: v })}
        placeholder="Description — who they are and what they own. This is read on every run."
        className="mt-2.5 w-full"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn onClick={save} disabled={saving || !draft.new_name.trim()} tone="primary">
          <Check size={14} /> {saving ? 'Saving…' : isNew ? 'Add' : 'Save'}
        </Btn>
        <Btn onClick={onCancel} tone="ghost">
          Cancel
        </Btn>
        <span className="ml-auto text-[11.5px] text-faint">
          {isNew
            ? 'Fed into every run from now on.'
            : 'A hand-corrected name is kept; later runs cannot rewrite it.'}
        </span>
      </div>
    </div>
  );
}

function draftOf(p: Person): PersonEdit {
  return {
    new_name: p.name,
    org: p.org ?? '',
    role: p.role ?? '',
    note: p.notes.length ? p.notes[p.notes.length - 1] : '',
    aliases: [...p.aliases],
  };
}

function Field({
  value,
  onChange,
  placeholder,
  className = '',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-edge bg-sunken px-2.5 py-1.5 text-[13px] text-ink outline-none transition-shadow placeholder:text-faint focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/10 ${className}`}
    />
  );
}
