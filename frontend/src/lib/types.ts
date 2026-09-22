export interface Flag {
  id: number;
  fail: boolean;
  para: number;
  ts: string;
  before: string;
  why: string;
}

export interface ScanState {
  para: number;
  ts: string;
  flag: number;
}

export interface Chunk {
  orig: string;
  ow: number;
  text: string;
  done: boolean;
  error: string;
  flags: Flag[];
  end: ScanState | null;
}

export interface Item {
  title: string;
  owner: string;
  detail: string;
  due: string;
  blocking: boolean;
  source_quote: string;
  on: boolean;
}

export interface Question {
  question: string;
  raised_by: string;
  why_open: string;
  on: boolean;
}

export interface Agent {
  summary: string;
  items: Item[];
  questions: Question[];
  log: [string, string][];
  done: boolean;
  failed?: string;
}

export type Phase = 'idle' | 'cleaning' | 'agent' | 'memo' | 'learning' | 'done' | 'stopped' | 'error';

export interface Decision {
  title: string;
  recommend: string;
  why: string;
  owner: string;
  by_when: string;
  blocks: string;
}

export interface Memo {
  decisions: Decision[];
  consequences: string;
  log: [string, string][];
  done: boolean;
  failed?: string;
}

export interface Person {
  name: string;
  org: string;
  role: string;
  aliases: string[];
  notes: string[];
  meetings: number;
  seen_in: string[];
  pinned?: boolean;   // corrected by hand; later runs may not rename it
}

// A hand edit. `new_name` is the name as the operator wants it spelled; the rest replace what
// the model wrote, and an omitted alias is one the operator says is a different person.
export interface PersonEdit {
  new_name: string;
  org?: string;
  role?: string;
  note?: string;
  aliases?: string[];
}
