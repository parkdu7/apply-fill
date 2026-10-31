// content script가 처리하는 메시지. 테스트에서는 이 파일만 페이지에 넣어 확인한다.
import type { ClfApi } from '../../../fill-mcp/src/dom/index';
import type { DialogRecord } from '../../../fill-mcp/src/transport';

export type ContentMsg =
  | { t: 'clf'; fn: string; args: unknown[] }
  | { t: 'size' }
  | { t: 'agent'; on: boolean }
  | { t: 'dialogs'; since: number }
  /** 계정 보관함 로그인: background가 이 프레임 origin에 묶인 계정만 보낸다. 여기서 한 번 더 확인한다 */
  | { t: 'loginFill'; origin: string; username: string; password: string };

const dialogs: DialogRecord[] = [];
document.addEventListener('clf-dialog', (e) => {
  try {
    dialogs.push(JSON.parse(String((e as CustomEvent).detail)) as DialogRecord);
    if (dialogs.length > 50) dialogs.shift();
  } catch {
    /* 무시 */
  }
});

let agentOff: ReturnType<typeof setTimeout> | undefined;

function api(): Record<string, (...a: unknown[]) => unknown> {
  return (window as unknown as { __clf: ClfApi }).__clf as unknown as Record<string, (...a: unknown[]) => unknown>;
}

export async function handleContent(msg: ContentMsg): Promise<unknown> {
  switch (msg.t) {
    case 'clf': {
      const fn = api()[msg.fn];
      if (typeof fn !== 'function') throw new Error(`없는 함수: ${msg.fn}`);
      return await fn(...msg.args);
    }
    case 'size':
      return { w: window.innerWidth, h: window.innerHeight, origin: location.origin };
    case 'agent': {
      // 끝나고 1.5초는 더 대신 처리한다 (클릭 직후 뜨는 확인창)
      clearTimeout(agentOff);
      if (msg.on) document.documentElement.dataset.clfAgent = '1';
      else agentOff = setTimeout(() => delete document.documentElement.dataset.clfAgent, 1500);
      return true;
    }
    case 'dialogs':
      return dialogs.filter((d) => d.at >= msg.since);
    case 'loginFill':
      if (location.origin.toLowerCase() !== msg.origin) throw new Error('origin이 저장된 계정과 달라요');
      return api().fillLogin(msg.username, msg.password);
  }
}
