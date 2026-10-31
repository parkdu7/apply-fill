// 서비스 워커: 사이드패널 ↔ native host ↔ content script 중계.
// - 사이드패널이 [채우기]를 누르면 그 탭을 작업 탭으로 정하고 호스트에 실행을 맡긴다.
// - 호스트가 넘기는 브리지 요청(fill-mcp → 확장)을 content script로 실행해서 돌려준다.
// - 파일 첨부·로그인은 여기서 보관함을 읽어 content script로 바로 보낸다 (내용·비밀번호가 호스트로 가지 않는다).
import type { DialogRecord } from '../../../fill-mcp/src/transport';
import { filePayload, getFile, listFiles } from '../shared/files-db';
import type { PanelEvent, PanelMsg, PanelState } from '../shared/panel';
import { HOST_NAME, type AttachOutcome, type BridgeRequest, type BridgeTab, type FromHost, type LoginOutcome, type ToHost } from '../shared/protocol';
import { runLogin, type LoginDetect } from '../shared/login-flow';
import { AUTO_LOCK_MIN, importKey, type VaultData } from '../shared/vault';

const IGNORED_FRAME = /channel\.io|googletagmanager|doubleclick|recaptcha|facebook\.com|youtube\.com|kakao\.com|wcs\.naver/i;
/** LLM이 브리지로 직접 부를 수 없는 dom 함수 (보관함 내용이 들어가는 것) */
const PRIVATE_FN = new Set(['fillLogin', 'attachFile']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── 상태 (서비스 워커가 다시 떠도 사이드패널이 이어 보도록 session에 둔다) ──
let state: PanelState = { running: false, events: [], questions: [], host: 'unknown' };
let workTabId: number | undefined;
let externalHosts: string[] = [];
const panels = new Set<chrome.runtime.Port>();
let nativePort: chrome.runtime.Port | undefined;

const restored = chrome.storage.session.get(['panelState', 'workTabId']).then((v) => {
  if (v.panelState) state = v.panelState as PanelState;
  if (typeof v.workTabId === 'number') workTabId = v.workTabId;
});

function save(): void {
  void chrome.storage.session.set({ panelState: { ...state, events: state.events.slice(-300) }, workTabId });
}

function emit(e: PanelEvent): void {
  for (const p of panels) p.postMessage(e);
}

function pushEvent(ev: PanelState['events'][number]): void {
  state.events.push(ev);
  if (state.events.length > 300) state.events.shift();
  emit({ t: 'event', event: ev });
  save();
}

// ── native host ──
function host(): chrome.runtime.Port {
  if (nativePort) return nativePort;
  const port = chrome.runtime.connectNative(HOST_NAME);
  nativePort = port;
  state.host = 'connected';
  port.onMessage.addListener((m: FromHost) => void onHost(m));
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message;
    nativePort = undefined;
    state.host = 'down';
    if (state.running) {
      state.running = false;
      pushEvent({ kind: 'done', done: { isError: true, result: `호스트 연결이 끊겼어요${err ? `: ${err}` : ''}` }, at: Date.now() });
    }
    emit({ t: 'host-down', error: err });
    save();
  });
  return port;
}

function toHost(m: ToHost): void {
  try {
    host().postMessage(m);
  } catch (e) {
    emit({ t: 'host-down', error: e instanceof Error ? e.message : String(e) });
  }
}

async function onHost(m: FromHost): Promise<void> {
  switch (m.type) {
    case 'rpc': {
      try {
        const result = await rpc(m.req);
        toHost({ type: 'rpc-result', id: m.id, ok: true, result });
      } catch (e) {
        const err = e as Error & { code?: string };
        toHost({ type: 'rpc-result', id: m.id, ok: false, error: err.message ?? String(e), code: err.code });
      }
      return;
    }
    case 'event':
      pushEvent({ kind: 'run', event: m.event, at: Date.now() });
      if (m.event.kind === 'init') state.sessionId = m.event.sessionId;
      return;
    case 'done':
      state.running = false;
      if (m.done.sessionId) state.sessionId = m.done.sessionId;
      pushEvent({ kind: 'done', done: m.done, at: Date.now() });
      return;
    case 'status':
      state.status = m.status;
      emit({ t: 'status', status: m.status });
      save();
      return;
    default:
      emit({ t: 'host', msg: m });
  }
}

// ── 작업 탭 ──
const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

async function tabInfo(tabId: number): Promise<BridgeTab> {
  const t = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!t) throw coded('작업 탭이 닫혔어요. 지원서 탭에서 [채우기]를 다시 눌러 주세요.', 'no_tab');
  return { tabId, url: t.url ?? t.pendingUrl ?? '', title: t.title ?? '', active: t.active };
}

async function workTab(): Promise<BridgeTab> {
  await restored;
  if (workTabId === undefined) {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!t?.id) throw coded('작업할 탭이 없어요.', 'no_tab');
    workTabId = t.id;
  }
  return tabInfo(workTabId);
}

const hostOf = (url = '') => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

// 작업 탭에서 열린 새 탭: 같은 사이트면 따라가고(지원서가 새 창으로 열리는 사이트), 다른 사이트면 알리기만 한다
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || tab.openerTabId === undefined || tab.openerTabId !== workTabId || tabId === workTabId) return;
  void chrome.tabs.get(workTabId).then((cur) => {
    if (hostOf(tab.url) && hostOf(tab.url) === hostOf(cur.url)) {
      workTabId = tabId;
      save();
    } else if (hostOf(tab.url)) externalHosts.push(hostOf(tab.url));
  });
});

async function waitComplete(tabId: number, ms = 15000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!t || t.status === 'complete') return;
    await sleep(200);
  }
}

// ── content script 호출 ──
async function inject(tabId: number, frameId?: number): Promise<void> {
  const files = chrome.runtime.getManifest().content_scripts?.flatMap((c) => ((c as { world?: string }).world === 'MAIN' ? [] : (c.js ?? []))) ?? [];
  await chrome.scripting.executeScript({ target: { tabId, ...(frameId !== undefined ? { frameIds: [frameId] } : { allFrames: true }) }, files });
}

async function send<T>(tabId: number, frameId: number, msg: unknown, timeoutMs = 45000): Promise<T> {
  const once = () =>
    Promise.race([
      chrome.tabs.sendMessage(tabId, msg, { frameId }) as Promise<{ ok: boolean; result?: T; error?: string } | undefined>,
      sleep(timeoutMs).then(() => {
        throw coded('페이지가 응답하지 않아요. 브라우저에 확인창이 떠 있으면 닫아 주세요.', 'timeout');
      }),
    ]);
  let r: { ok: boolean; result?: T; error?: string } | undefined;
  try {
    r = await once();
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!/Receiving end does not exist|Could not establish connection/i.test(m)) {
      if (/No tab with id/i.test(m)) throw coded('작업 탭이 닫혔어요.', 'no_tab');
      if (/No frame with id|frame.*removed/i.test(m)) throw coded('프레임이 사라졌어요.', 'no_frame');
      throw e;
    }
    // 확장을 설치하기 전부터 열려 있던 탭: content script를 넣고 다시
    try {
      await inject(tabId, frameId);
    } catch (ie) {
      const im = ie instanceof Error ? ie.message : String(ie);
      throw coded(`이 프레임에 들어갈 수 없어요: ${im}`, /frame/i.test(im) ? 'no_frame' : 'inject');
    }
    r = await once();
  }
  if (!r) throw coded('content script 응답이 없어요.', 'no_frame');
  if (!r.ok) throw new Error(r.error ?? '알 수 없는 오류');
  return r.result as T;
}

async function frameList(tabId: number): Promise<chrome.webNavigation.GetAllFrameResultDetails[]> {
  const all = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [];
  return all.filter((f) => f.frameId === 0 || (/^(https?:|about:)/.test(f.url) && !IGNORED_FRAME.test(f.url)));
}

async function frames(tabId: number): Promise<{ frameId: number; url: string }[]> {
  const out: { frameId: number; url: string }[] = [];
  for (const f of await frameList(tabId)) {
    if (f.frameId === 0) {
      out.unshift({ frameId: 0, url: f.url });
      continue;
    }
    const size = await send<{ w: number; h: number }>(tabId, f.frameId, { t: 'size' }, 1500).catch(() => undefined);
    if (size && size.w >= 50 && size.h >= 30) out.push({ frameId: f.frameId, url: f.url });
  }
  if (!out.length || out[0].frameId !== 0) out.unshift({ frameId: 0, url: (await tabInfo(tabId)).url });
  return out;
}

async function eachFrame<T>(tabId: number, msg: unknown): Promise<{ frameId: number; url: string; result: T }[]> {
  const out: { frameId: number; url: string; result: T }[] = [];
  for (const f of await frameList(tabId)) {
    const result = await send<T>(tabId, f.frameId, msg, 3000).catch(() => undefined);
    if (result !== undefined) out.push({ frameId: f.frameId, url: f.url, result });
  }
  return out;
}

// ── 진짜 입력 (chrome.debugger) ──
// 실제 키 입력(isTrusted)에만 반응하는 칸에서만 쓴다. 붙어 있는 동안 크롬 위에 "디버깅 중" 알림줄이 뜨고, 끝나면 바로 뗀다.
const debugging = new Set<number>();
chrome.debugger.onDetach.addListener((src) => {
  if (src.tabId !== undefined) debugging.delete(src.tabId);
});

async function cdp(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (!debugging.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3');
    debugging.add(tabId);
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function detach(tabId: number): Promise<void> {
  if (!debugging.delete(tabId)) return;
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

/** 프레임 안 좌표 → 탭(메인 프레임) 좌표: 부모 프레임마다 iframe 위치를 더한다 */
async function toTabPoint(tabId: number, frameId: number, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const all = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  let cur = all.find((f) => f.frameId === frameId);
  let { x, y } = p;
  while (cur && cur.parentFrameId >= 0) {
    const off = await send<{ x: number; y: number } | null>(tabId, cur.parentFrameId, { t: 'clf', fn: 'frameOffset', args: [cur.url] }, 3000);
    if (!off) throw new Error('프레임 위치를 찾지 못했어요');
    x += off.x;
    y += off.y;
    cur = all.find((f) => f.frameId === cur!.parentFrameId);
  }
  return { x, y };
}

const KEY_DEFS = {
  selectAll: { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 },
  backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, modifiers: 0 },
  tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 0 },
} as const;

async function trusted(req: Extract<BridgeRequest, { op: 'trusted' }>): Promise<true> {
  const { tabId, frameId, selector } = req;
  if (req.action === 'click') {
    const r = await send<{ x: number; y: number }>(tabId, frameId, { t: 'clf', fn: 'rectOf', args: [selector] });
    const { x, y } = await toTabPoint(tabId, frameId, r);
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return true;
  }
  await send(tabId, frameId, { t: 'clf', fn: 'focusSel', args: [selector] });
  if (req.action === 'press') {
    const k = KEY_DEFS[req.key ?? 'tab'];
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    return true;
  }
  for (const ch of req.text ?? '') {
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    if (req.delayMs) await sleep(req.delayMs);
  }
  return true;
}

// ── 보관함 ──
async function vaultKey(): Promise<CryptoKey | undefined> {
  const { vaultKey: raw } = await chrome.storage.session.get('vaultKey');
  if (typeof raw !== 'string') return undefined;
  // 쓸 때마다 자동 잠금 시간을 늘린다
  await chrome.alarms.create('vault-lock', { delayInMinutes: AUTO_LOCK_MIN });
  return importKey(raw);
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'vault-lock') void chrome.storage.session.remove('vaultKey').then(() => emit({ t: 'vault-locked' }));
});

/** 로그인 시도 기록 (값 없이 결과만) */
async function logLogin(origin: string, status: LoginOutcome['status']): Promise<void> {
  const { loginLog = [] } = await chrome.storage.local.get('loginLog');
  const next = [...(loginLog as unknown[]), { origin, status, at: new Date().toISOString() }].slice(-100);
  await chrome.storage.local.set({ loginLog: next });
}

function login(tabId: number): Promise<LoginOutcome> {
  return runLogin({
    detect: () => eachFrame<LoginDetect>(tabId, { t: 'clf', fn: 'detectLogin', args: [] }),
    vault: async () => (await chrome.storage.local.get('vault')).vault as VaultData | undefined,
    key: vaultKey,
    // 비밀번호는 여기서 그 프레임으로 바로 간다 (content script가 프레임 origin을 한 번 더 확인)
    fill: async (frameId, msg) => {
      await send(tabId, frameId, { t: 'loginFill', ...msg }, 10000);
    },
    settle: async () => {
      await sleep(1500);
      await waitComplete(tabId, 10000);
      await sleep(500);
    },
    url: async () => (await tabInfo(tabId)).url,
    log: logLogin,
  });
}

async function attach(tabId: number, frameId: number, key: string, fileId: string): Promise<AttachOutcome> {
  const f = await getFile(fileId);
  if (!f) return { ok: false, message: '보관함에 그 파일이 없어요.' };
  return send<AttachOutcome>(tabId, frameId, { t: 'clf', fn: 'attachFile', args: [key, await filePayload(f)] }, 30000);
}

// ── 브리지 요청 처리 ──
async function rpc(req: BridgeRequest): Promise<unknown> {
  switch (req.op) {
    case 'page':
      return workTab();
    case 'tabs': {
      const cur = await workTab();
      const t = await chrome.tabs.get(cur.tabId);
      const list = await chrome.tabs.query({ windowId: t.windowId });
      return list.filter((x) => x.id !== undefined).map((x) => ({ tabId: x.id!, url: x.url ?? '', title: x.title ?? '', active: x.id === cur.tabId }));
    }
    case 'open': {
      const cur = await workTab();
      if (!req.url) return cur;
      const blank = /^(about:blank|chrome:\/\/newtab)/.test(cur.url);
      const t = blank ? await chrome.tabs.update(cur.tabId, { url: req.url }) : await chrome.tabs.create({ url: req.url, openerTabId: cur.tabId });
      workTabId = t!.id!;
      save();
      await sleep(300);
      await waitComplete(workTabId, 30000);
      return tabInfo(workTabId);
    }
    case 'select': {
      const list = (await rpc({ op: 'tabs' })) as BridgeTab[];
      const t = list[req.index];
      if (!t) throw new Error(`${req.index}번 탭이 없어요 (0~${list.length - 1}).`);
      workTabId = t.tabId;
      save();
      await chrome.tabs.update(t.tabId, { active: true });
      return tabInfo(t.tabId);
    }
    case 'frames':
      return frames(req.tabId);
    case 'call':
      if (PRIVATE_FN.has(req.fn)) throw new Error(`${req.fn}은(는) 직접 부를 수 없어요`);
      return send(req.tabId, req.frameId, { t: 'clf', fn: req.fn, args: req.args });
    case 'trusted':
      return trusted(req);
    case 'trusted-end':
      await detach(req.tabId);
      return true;
    case 'settle': {
      await sleep(400);
      const t = await chrome.tabs.get(req.tabId).catch(() => undefined);
      if (t && (t.status === 'loading' || t.url !== req.urlBefore)) await waitComplete(req.tabId);
      await sleep(300);
      return (await tabInfo(req.tabId)).url;
    }
    case 'html':
      return (await eachFrame<string>(req.tabId, { t: 'clf', fn: 'html', args: [] })).map((f) => ({ url: f.url, html: f.result }));
    case 'agent':
      await eachFrame(req.tabId, { t: 'agent', on: req.on });
      return true;
    case 'dialogs':
      return (await eachFrame<DialogRecord[]>(req.tabId, { t: 'dialogs', since: req.since })).flatMap((f) => f.result).sort((a, b) => a.at - b.at);
    case 'external': {
      const h = externalHosts;
      externalHosts = [];
      return h;
    }
    case 'popups': {
      const list = await chrome.tabs.query({});
      return list.filter((x) => x.openerTabId === req.tabId && x.id !== req.tabId).map((x) => ({ tabId: x.id!, url: x.url ?? '', title: x.title ?? '' }));
    }
    case 'files':
      return listFiles();
    case 'attach':
      return attach(req.tabId, req.frameId, req.key, req.fileId);
    case 'ask':
      state.questions = req.questions;
      emit({ t: 'ask', questions: req.questions });
      save();
      return true;
    case 'progress':
      pushEvent({ kind: 'note', text: req.text, at: Date.now() });
      return true;
    case 'login':
      return login(req.tabId);
  }
}

// ── 사이드패널 ──
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  panels.add(port);
  void restored.then(() => port.postMessage({ t: 'state', state } satisfies PanelEvent));
  port.onDisconnect.addListener(() => panels.delete(port));
  port.onMessage.addListener((m: PanelMsg) => void onPanel(m));
});

async function onPanel(m: PanelMsg): Promise<void> {
  await restored;
  switch (m.t) {
    case 'status':
      toHost({ type: 'status' });
      break;
    case 'login':
      toHost({ type: 'login' });
      break;
    case 'run': {
      workTabId = m.tabId;
      externalHosts = [];
      const tab = await tabInfo(m.tabId);
      state.running = true;
      state.questions = [];
      if (!m.resume) state.events = [];
      pushEvent({ kind: 'start', text: m.resume ? '답을 보내고 이어서 진행해요' : `채우기 시작: ${tab.title || tab.url}`, at: Date.now() });
      toHost({ type: 'run', run: { prompt: m.prompt, resume: m.resume, tabUrl: tab.url, model: m.model } });
      break;
    }
    case 'cancel':
      toHost({ type: 'cancel' });
      break;
    case 'toHost':
      toHost(m.msg);
      break;
    case 'clear':
      state.events = [];
      state.questions = [];
      state.sessionId = undefined;
      save();
      emit({ t: 'state', state });
      break;
  }
}
