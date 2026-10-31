// 확장 모드 통신: fill-mcp(이 프로세스) → 127.0.0.1 WebSocket → native host → 크롬 확장(background) → content script.
// native host가 claude를 띄울 때 주소와 일회용 토큰을 환경변수(CAREERLOG_BRIDGE, CAREERLOG_BRIDGE_TOKEN)로 넘긴다.
// 이 파일의 타입은 확장(extension/)과 호스트도 같이 쓴다.

/** 탭 정보 (확장이 돌려준다) */
export interface BridgeTab {
  tabId: number;
  url: string;
  title: string;
  active?: boolean;
}

export interface BridgeFrame {
  frameId: number;
  url: string;
}

/** 확장에 시키는 일. 결과 타입은 주석 */
export type BridgeRequest =
  /** → BridgeTab: 작업 탭 (사용자가 [채우기]를 누른 탭, 같은 사이트 새 탭이면 따라간다) */
  | { op: 'page' }
  /** → BridgeTab[] */
  | { op: 'tabs' }
  /** → BridgeTab */
  | { op: 'open'; url?: string }
  /** → BridgeTab */
  | { op: 'select'; index: number }
  /** → BridgeFrame[] (메인 먼저, 광고·작은 프레임 제외) */
  | { op: 'frames'; tabId: number }
  /** → dom 함수 결과. __clf[fn](...args) */
  | { op: 'call'; tabId: number; frameId: number; fn: string; args: unknown[] }
  /** 진짜 입력(chrome.debugger). 흉내 입력이 안 먹는 칸에서만 쓴다 → true */
  | { op: 'trusted'; tabId: number; frameId: number; action: 'click' | 'type' | 'press'; selector: string; text?: string; key?: 'selectAll' | 'backspace' | 'tab'; delayMs?: number }
  /** 진짜 입력 끝 (디버거 분리) → true */
  | { op: 'trusted-end'; tabId: number }
  /** → string (가라앉은 뒤 주소) */
  | { op: 'settle'; tabId: number; urlBefore: string }
  /** → { url, html }[] */
  | { op: 'html'; tabId: number }
  /** 에이전트 동작 구간 표시 (확인창 대신 처리) → true */
  | { op: 'agent'; tabId: number; on: boolean }
  /** → DialogRecord[] */
  | { op: 'dialogs'; tabId: number; since: number }
  /** → string[] (작업 탭과 다른 사이트로 열린 탭 호스트, 읽으면 비운다) */
  | { op: 'external' }
  /** → BridgeTab[] (작업 탭에서 열린 팝업 창·탭) */
  | { op: 'popups'; tabId: number }
  /** 파일 보관함 목록 → VaultFile[] (내용 없이) */
  | { op: 'files' }
  /** 보관함 파일을 칸에 첨부 → AttachOutcome (내용은 확장 안에서만 오간다) */
  | { op: 'attach'; tabId: number; frameId: number; key: string; fileId: string }
  /** 사이드패널에 질문 올리기 → true */
  | { op: 'ask'; questions: AskQuestion[] }
  /** 사이드패널 진행 상황 한 줄 → true */
  | { op: 'progress'; text: string }
  /** 계정 보관함으로 로그인 → LoginOutcome (비밀번호는 확장 밖으로 나오지 않는다) */
  | { op: 'login'; tabId: number };

export interface VaultFile {
  id: string;
  name: string;
  /** 사용자가 붙인 종류 (졸업증명서, 성적증명서, 자격증 사본, 포트폴리오 …) */
  kind: string;
  size: number;
  type: string;
  /** 발급일 (YYYY-MM-DD, 사용자가 입력) */
  issued?: string;
  addedAt: string;
}

export interface AttachOutcome {
  ok: boolean;
  /** 페이지에 보이는 파일 이름 (다시 읽은 값) */
  shown?: string;
  message?: string;
}

export interface AskQuestion {
  id: string;
  text: string;
  /** 고를 수 있는 답 (없으면 자유 입력) */
  options?: string[];
  /** 프로필 경로: 답을 저장할 곳 (예: "기본정보.영문이름") */
  path?: string;
}

export interface LoginOutcome {
  status: 'logged_in' | 'no_account' | 'locked' | 'challenge' | 'no_form' | 'failed' | 'domain_mismatch';
  message: string;
}

export type BridgeResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string; code?: string };

export const BRIDGE_TIMEOUT = 50000;

/** fill-mcp 쪽 클라이언트. Node 22 내장 WebSocket을 쓴다 */
export class BridgeClient {
  private ws?: WebSocket;
  private opening?: Promise<WebSocket>;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  constructor(
    private readonly url: string,
    private token: string | undefined,
  ) {}

  private open(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    this.opening ??= new Promise<WebSocket>((resolve, reject) => {
      if (!this.token) {
        reject(new Error('확장과 연결이 끊겼어요. 사이드패널에서 [채우기]를 다시 눌러 주세요.'));
        return;
      }
      const ws = new WebSocket(this.url);
      const token = this.token;
      // 토큰은 한 번만 쓴다 (호스트도 한 번 쓰면 지운다)
      this.token = undefined;
      ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 0, op: 'hello', token })));
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(String(ev.data)) as BridgeResponse;
        if (msg.id === 0) {
          if (msg.ok) {
            this.ws = ws;
            resolve(ws);
          } else reject(new Error(`확장 연결 거부: ${msg.error}`));
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(Object.assign(new Error(msg.error), { code: msg.code }));
      });
      ws.addEventListener('close', () => {
        this.ws = undefined;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('확장과 연결이 끊겼어요 (사이드패널이나 브라우저가 닫혔을 수 있어요).'));
          this.pending.delete(id);
        }
        reject(new Error('확장에 연결하지 못했어요.'));
      });
      ws.addEventListener('error', () => {
        /* close가 이어서 온다 */
      });
    }).finally(() => (this.opening = undefined));
    return this.opening;
  }

  async request<T>(req: BridgeRequest, timeoutMs = BRIDGE_TIMEOUT): Promise<T> {
    const ws = await this.open();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${req.op}: 페이지가 응답하지 않아요. 브라우저에 확인창이 떠 있으면 닫아 주세요.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ id, ...req }));
    });
  }

  close(): void {
    this.ws?.close();
  }
}
