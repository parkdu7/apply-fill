// 확장(background·사이드패널)과 native host 사이 메시지.
// 브리지(fill-mcp ↔ 확장) 요청 타입은 fill-mcp/src/bridge.ts에 있다.
import type { BridgeRequest } from '../../../fill-mcp/src/bridge';

export type { AskQuestion, AttachOutcome, BridgeRequest, BridgeTab, LoginOutcome, VaultFile } from '../../../fill-mcp/src/bridge';

export interface ClaudeStatus {
  found: boolean;
  path?: string;
  version?: string;
  loggedIn?: boolean;
  subscriptionType?: string;
  email?: string;
  error?: string;
}

export interface HostStatus {
  host: string;
  node: string;
  fillMcp: { path: string; found: boolean };
  claude: ClaudeStatus;
}

export interface RunOptions {
  /** 처음 채우기면 prompt, 질문에 답할 때는 resume + prompt(답) */
  prompt: string;
  resume?: string;
  tabUrl: string;
  model?: string;
}

/** 확장 → 호스트 */
export type ToHost =
  | { type: 'status' }
  | { type: 'login' }
  | { type: 'run'; run: RunOptions }
  | { type: 'cancel' }
  | { type: 'profile-get' }
  | { type: 'profile-save'; profile: unknown }
  | { type: 'rpc-result'; id: number; ok: true; result: unknown }
  | { type: 'rpc-result'; id: number; ok: false; error: string; code?: string };

/** 진행 상황 (stream-json을 줄인 것) */
export type RunEvent =
  | { kind: 'init'; sessionId: string; model?: string; mcp?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'tool_result'; name?: string; text: string; isError: boolean }
  | { kind: 'stderr'; text: string };

export interface RunDone {
  sessionId?: string;
  isError: boolean;
  result?: string;
  /** API 환산 금액 (구독은 실제 청구가 아님) */
  costUsd?: number;
  turns?: number;
  durationMs?: number;
  cancelled?: boolean;
}

/** 호스트 → 확장 */
export type FromHost =
  | { type: 'status'; status: HostStatus }
  | { type: 'login-output'; text: string }
  | { type: 'login-done'; ok: boolean }
  | { type: 'event'; event: RunEvent }
  | { type: 'done'; done: RunDone }
  | { type: 'profile'; profile: unknown; path: string; error?: string }
  | { type: 'profile-saved'; ok: boolean; error?: string }
  | { type: 'rpc'; id: number; req: BridgeRequest }
  | { type: 'error'; message: string };

export const HOST_NAME = 'com.careerlog.host';
