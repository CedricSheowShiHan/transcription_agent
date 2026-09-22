import type { Flag, ScanState } from './types';

export const words = (s: string): number => (s.match(/\S+/g) || []).length;
export const num = (n: number): string => n.toLocaleString();
export const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const FLAG = /\[FLAG:[^\]]*\]|\[CHUNK FAILED\]/g;

/** One segment of a chunk: plain text, or a flag that becomes a <mark>. */
export interface Seg {
  text: string;
  flagId: number | null;
  fail: boolean;
}

/**
 * Splits a chunk into segments and collects its flags in one pass.
 * `st` carries paragraph number, latest leading timestamp and flag count over from the
 * previous chunk, so ids and ¶ numbers stay continuous across the whole transcript.
 */
export function scan(
  text: string,
  st: ScanState,
  error: string,
): { segs: Seg[]; flags: Flag[] } {
  const segs: Seg[] = [];
  const flags: Flag[] = [];
  text
    .trimEnd()
    .split(/(\n[ \t]*\n\s*)/)
    .forEach((part, k) => {
      if (k % 2) {
        segs.push({ text: part, flagId: null, fail: false });
        return;
      }
      if (!part) return;
      st.para++;
      const ts = part.match(/^\W*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)/);
      if (ts) st.ts = ts[1];
      let last = 0;
      for (const m of part.matchAll(FLAG)) {
        const fail = m[0][1] === 'C';
        const id = st.flag++;
        segs.push({ text: part.slice(last, m.index), flagId: null, fail: false });
        segs.push({ text: m[0], flagId: id, fail });
        last = m.index! + m[0].length;
        flags.push({
          id,
          fail,
          para: st.para,
          ts: st.ts,
          before: part.slice(Math.max(0, m.index! - 60), m.index!).replace(/\s+/g, ' '),
          why: fail
            ? error || 'This chunk could not be cleaned; the original text is kept.'
            : m[0].slice(6, -1).trim(),
        });
      }
      segs.push({ text: part.slice(last), flagId: null, fail: false });
    });
  return { segs, flags };
}
