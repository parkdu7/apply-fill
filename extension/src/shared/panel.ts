// 사이드패널 ↔ background 메시지.
import type { AskQuestion, FromHost, HostStatus, RunDone, RunEvent, ToHost } from './protocol';

export type LogEntry =
  | { kind: 'start'; text: string; at: number }
  | { kind: 'run'; event: RunEvent; at: number }
  | { kind: 'note'; text: string; at: number }
  | { kind: 'done'; done: RunDone; at: number };

export interface PanelState {
  running: boolean;
  events: LogEntry[];
  questions: AskQuestion[];
  sessionId?: string;
  host: 'unknown' | 'connected' | 'down';
  status?: HostStatus;
}

/** 사이드패널 → background */
export type PanelMsg =
  | { t: 'status' }
  | { t: 'login' }
  | { t: 'run'; tabId: number; prompt: string; resume?: string; model?: string }
  | { t: 'cancel' }
  | { t: 'clear' }
  | { t: 'toHost'; msg: ToHost };

/** background → 사이드패널 */
export type PanelEvent =
  | { t: 'state'; state: PanelState }
  | { t: 'event'; event: LogEntry }
  | { t: 'status'; status: HostStatus }
  | { t: 'ask'; questions: AskQuestion[] }
  | { t: 'host'; msg: FromHost }
  | { t: 'host-down'; error?: string }
  | { t: 'vault-locked' };
