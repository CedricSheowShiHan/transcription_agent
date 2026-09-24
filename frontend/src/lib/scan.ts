import type { Flag, RawFlag, ScanState } from './types';

export const words = (s: string): number => (s.match(/\S+/g) || []).length;
export const num = (n: number): string => n.toLocaleString();
export const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Inserted by the app itself when a chunk failed or was never cleaned - not part of the
// model's structured flags, so matched separately.
const FAILURE = /\[CHUNK FAILED\]|\[CHUNK NOT CLEANED\]/g;

export interface Seg {
  text: string;
  flagId: number | null;
  fail: boolean;
}

interface Hit {
  start: number;
  end: number;
  fail: boolean;
  original: string;
  why: string;
}

/**
 * Splits a chunk into segments for highlighting and builds its flags list.
 *
 * Flags arrive as structured {original, corrected, reason} objects; `corrected` is matched
 * verbatim against the cleaned text to find where it goes. A flag whose text can't be found
 * (the model didn't copy it verbatim) is still listed below, just without a location to jump to.
 *
 * `st` carries paragraph number, latest timestamp and flag count over from the previous chunk,
 * so ids and paragraph numbers stay continuous across the whole transcript.
 */
export function scan(
  text: string,
  rawFlags: RawFlag[],
  st: ScanState,
  error: string,
): { segs: Seg[]; flags: Flag[] } {
  const trimmed = text.trimEnd();
  const hits: Hit[] = [];
  const unlocated: RawFlag[] = [];

  for (const f of rawFlags) {
    const idx = f.corrected ? trimmed.indexOf(f.corrected) : -1;
    if (idx === -1) {
      unlocated.push(f);
    } else {
      hits.push({ start: idx, end: idx + f.corrected.length, fail: false, original: f.original, why: f.reason });
    }
  }
  for (const m of trimmed.matchAll(FAILURE)) {
    hits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      fail: true,
      original: '',
      why: error || 'This chunk could not be cleaned; the original text is kept.',
    });
  }
  hits.sort((a, b) => a.start - b.start);

  const segs: Seg[] = [];
  const flags: Flag[] = [];
  let hi = 0;
  let pos = 0;

  trimmed.split(/(\n[ \t]*\n\s*)/).forEach((part, k) => {
    const start = pos;
    pos += part.length;
    if (k % 2) {
      segs.push({ text: part, flagId: null, fail: false });
      return;
    }
    if (!part) return;
    st.para++;
    const ts = part.match(/^\W*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)/);
    if (ts) st.ts = ts[1];

    let last = 0; // offset within `part`
    while (hi < hits.length && hits[hi].start < start + part.length) {
      const h = hits[hi++];
      const rs = h.start - start;
      const re = h.end - start;
      if (rs < last) continue; // overlapping hit; skip rather than corrupt the segments
      segs.push({ text: part.slice(last, rs), flagId: null, fail: false });
      const id = st.flag++;
      segs.push({ text: part.slice(rs, re), flagId: id, fail: h.fail });
      flags.push({
        id,
        fail: h.fail,
        located: true,
        para: st.para,
        ts: st.ts,
        before: part.slice(Math.max(0, rs - 60), rs).replace(/\s+/g, ' '),
        original: h.original,
        why: h.why,
      });
      last = re;
    }
    segs.push({ text: part.slice(last), flagId: null, fail: false });
  });

  for (const f of unlocated) {
    flags.push({ id: st.flag++, fail: false, located: false, para: 0, ts: '', before: '', original: f.original, why: f.reason });
  }

  return { segs, flags };
}

/**
 * Re-runs `scan` for one chunk and substitutes any operator override for each flagged span,
 * producing exactly the text that chunk contributes to the exported transcript. `st` must be
 * threaded across chunks in the same order the UI scans them, so a flag's id here lines up with
 * the id the operator saw (and overrode) on screen. `overrides` is keyed by that id; a missing
 * entry falls back to the model's own wording, same as an unedited flag renders in the Cleaned
 * pane.
 */
export function applyChunk(
  text: string,
  rawFlags: RawFlag[],
  overrides: Record<number, string>,
  st: ScanState,
  error = '',
): string {
  const { segs } = scan(text, rawFlags, st, error);
  const trailing = text.slice(text.trimEnd().length); // scan() trims this off; preserve it verbatim
  return (
    segs.map((s) => (s.flagId != null && overrides[s.flagId] != null ? overrides[s.flagId] : s.text)).join('') +
    trailing
  );
}
