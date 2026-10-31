// Chrome native messaging 형식: 4바이트 길이(리틀엔디언, 네이티브 바이트 순서) + UTF-8 JSON.
// 호스트 → 크롬 메시지는 1MB까지라 넘으면 줄여서 보낸다.
import type { Readable, Writable } from 'node:stream';

export const MAX_TO_CHROME = 1024 * 1024;

export function encode(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** 길이 접두 메시지를 잘라서 하나씩 넘긴다 */
export function decoder(onMessage: (msg: unknown) => void): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const body = buf.subarray(4, 4 + len).toString('utf8');
      buf = buf.subarray(4 + len);
      try {
        onMessage(JSON.parse(body));
      } catch {
        // 깨진 메시지는 버린다
      }
    }
  };
}

export class NativePort {
  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  onMessage(fn: (msg: unknown) => void): void {
    this.input.on('data', decoder(fn));
  }

  onClose(fn: () => void): void {
    this.input.on('end', fn);
    this.input.on('close', fn);
  }

  send(msg: unknown): void {
    let frame = encode(msg);
    if (frame.length > MAX_TO_CHROME) frame = encode({ type: 'error', message: `메시지가 너무 커서 보내지 못했어요 (${frame.length}바이트)` });
    this.output.write(frame);
  }
}
