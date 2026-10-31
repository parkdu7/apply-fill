// fill-mcp가 붙는 127.0.0.1 WebSocket. 실행마다 일회용 토큰을 만들고, 한 번 쓰면 지운다.
// 브라우저 페이지에서 오는 연결(Origin 헤더가 있는 것)은 받지 않는다.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { BridgeRequest } from '../../src/shared/protocol';

type Relay = (id: number, req: BridgeRequest) => void;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class BridgeServer {
  private wss?: WebSocketServer;
  private token?: string;
  private client?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { ws: WebSocket; clientId: number }>();

  constructor(private readonly relay: Relay) {}

  async start(): Promise<string> {
    if (this.wss) return this.url();
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      maxPayload: 8 * 1024 * 1024,
      verifyClient: (info: { origin?: string }) => !info.origin,
    });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    wss.on('connection', (ws) => this.accept(ws));
    this.wss = wss;
    return this.url();
  }

  url(): string {
    const a = this.wss!.address() as AddressInfo;
    return `ws://127.0.0.1:${a.port}`;
  }

  /** 새 실행용 토큰. 이전 연결은 끊는다 */
  issueToken(): string {
    this.client?.close();
    this.client = undefined;
    this.token = randomBytes(24).toString('base64url');
    return this.token;
  }

  private accept(ws: WebSocket): void {
    let authed = false;
    ws.on('message', (data) => {
      let m: { id: number; op: string; token?: string } & Record<string, unknown>;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!authed) {
        if (m.op === 'hello' && typeof m.token === 'string' && this.token && same(m.token, this.token)) {
          authed = true;
          this.token = undefined;
          this.client = ws;
          ws.send(JSON.stringify({ id: 0, ok: true, result: true }));
        } else {
          ws.send(JSON.stringify({ id: 0, ok: false, error: '토큰이 맞지 않아요' }));
          ws.close();
        }
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { ws, clientId: m.id });
      const { id: _drop, ...req } = m;
      this.relay(id, req as unknown as BridgeRequest);
    });
    ws.on('close', () => {
      for (const [id, p] of this.pending) if (p.ws === ws) this.pending.delete(id);
      if (this.client === ws) this.client = undefined;
    });
  }

  /** 확장이 돌려준 결과를 fill-mcp에 전달 */
  deliver(id: number, msg: { ok: boolean; result?: unknown; error?: string; code?: string }): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.ws.send(JSON.stringify(msg.ok ? { id: p.clientId, ok: true, result: msg.result } : { id: p.clientId, ok: false, error: msg.error, code: msg.code }));
  }

  close(): void {
    this.wss?.close();
  }
}
