// 사이드패널: Claude 연결 상태, [채우기], 진행 상황, 질문 답하기, 파일·계정 보관함, 프로필.
import { addFile, listFiles, removeFile } from '../shared/files-db';
import type { LogEntry, PanelEvent, PanelMsg, PanelState } from '../shared/panel';
import type { AskQuestion, HostStatus, ToHost } from '../shared/protocol';
import { addAccount, AUTO_LOCK_MIN, createVault, exportKey, importKey, unlockVault, type VaultData } from '../shared/vault';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

const FILL_PROMPT =
  '지금 작업 탭의 지원서 기본정보를 내 프로필로 채워 줘. 자기소개서·동의·제출은 건드리지 말고, 프로필에 없는 값은 ask_user로 한 번에 물어봐. 끝나면 확인할 칸과 내가 직접 할 일을 짧게 정리해 줘.';

let state: PanelState = { running: false, events: [], questions: [], host: 'unknown' };
let port: chrome.runtime.Port;

function connect(): void {
  port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener((e: PanelEvent) => onEvent(e));
  // 서비스 워커가 내려가면 다시 붙는다
  port.onDisconnect.addListener(() => setTimeout(connect, 500));
}

const post = (m: PanelMsg) => port.postMessage(m);
const toHost = (msg: ToHost) => post({ t: 'toHost', msg });

// ── 탭 ──
for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll<HTMLButtonElement>('#tabs button')) x.classList.toggle('on', x === b);
    for (const s of document.querySelectorAll<HTMLElement>('main > section')) s.hidden = s.id !== `tab-${b.dataset.tab}`;
    if (b.dataset.tab === 'files') void renderFiles();
    if (b.dataset.tab === 'accounts') void renderVault();
    if (b.dataset.tab === 'profile' && !$<HTMLTextAreaElement>('profile').value) toHost({ type: 'profile-get' });
  });
}

// ── 상태 ──
function renderStatus(s?: HostStatus, down?: string): void {
  const conn = $('conn');
  const box = $('status');
  if (down || state.host === 'down') {
    conn.textContent = '호스트 없음';
    conn.className = 'pill err';
    box.innerHTML = `호스트에 연결하지 못했어요${down ? `: ${esc(down)}` : ''}.<br>README의 설치 순서대로 <code>npm run install-host</code>를 실행한 뒤 <button id="recheck">다시 확인</button>`;
    $('recheck')?.addEventListener('click', () => post({ t: 'status' }));
    return;
  }
  if (!s) {
    box.textContent = '상태 확인 중…';
    return;
  }
  const c = s.claude;
  const ok = c.found && c.loggedIn && s.fillMcp.found;
  conn.textContent = ok ? `Claude ${c.subscriptionType ?? ''} 연결됨` : '설정 필요';
  conn.className = `pill ${ok ? 'ok' : 'err'}`;
  const lines = [
    c.found ? `Claude Code ${esc(c.version ?? '?')} — ${c.loggedIn ? `로그인됨 (${esc(c.subscriptionType ?? '')}${c.email ? `, ${esc(c.email)}` : ''})` : '로그인 필요'}` : esc(c.error ?? 'Claude Code 없음'),
    s.fillMcp.found ? '' : `fill-mcp 빌드가 없어요: ${esc(s.fillMcp.path)}`,
  ].filter(Boolean);
  box.innerHTML = `${lines.join('<br>')} <button id="recheck" class="link">다시 확인</button>${c.found && !c.loggedIn ? ' <button id="claude-login">Claude 로그인</button>' : ''}`;
  $('recheck')?.addEventListener('click', () => post({ t: 'status' }));
  $('claude-login')?.addEventListener('click', () => post({ t: 'login' }));
  $<HTMLButtonElement>('fill').disabled = !ok || state.running;
}

// ── 진행 기록 ──
function logItem(e: LogEntry): HTMLLIElement {
  const li = document.createElement('li');
  if (e.kind === 'start' || e.kind === 'note') li.textContent = e.text;
  else if (e.kind === 'done') {
    li.className = e.done.isError ? 'done err' : 'done';
    const cost = e.done.costUsd !== undefined ? `\nAPI 환산 $${e.done.costUsd.toFixed(3)} (구독은 따로 청구되지 않고 사용 한도에서 차감돼요)` : '';
    const time = e.done.durationMs ? ` · ${Math.round(e.done.durationMs / 1000)}초` : '';
    li.textContent = `${e.done.cancelled ? '멈춤' : e.done.isError ? '오류' : '완료'}${time}\n${e.done.result ?? ''}${cost}`;
  } else {
    const ev = e.event;
    if (ev.kind === 'init') li.textContent = `Claude 시작 (${ev.model ?? ''})${ev.mcp && ev.mcp !== 'connected' ? ` — 도구 서버 상태: ${ev.mcp}` : ''}`;
    else if (ev.kind === 'text') li.textContent = ev.text;
    else if (ev.kind === 'tool') {
      li.className = 'tool';
      li.textContent = `▸ ${ev.name} ${ev.summary}`;
    } else if (ev.kind === 'tool_result') {
      li.className = ev.isError ? 'tool err' : 'tool';
      li.innerHTML = `<details><summary>${esc(ev.name ?? '결과')} 결과</summary><pre>${esc(ev.text)}</pre></details>`;
    } else if (ev.kind === 'stderr') {
      li.className = 'err';
      li.textContent = ev.text;
    }
  }
  return li;
}

function renderLog(): void {
  const ol = $('log');
  ol.replaceChildren(...state.events.map(logItem));
  ol.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

function renderRunning(): void {
  $<HTMLButtonElement>('fill').disabled = state.running || !(state.status?.claude.loggedIn && state.status.fillMcp.found);
  $('cancel').hidden = !state.running;
}

// ── 질문 ──
function renderQuestions(): void {
  const form = $<HTMLFormElement>('questions');
  const qs = state.questions;
  form.hidden = !qs.length || state.running;
  if (!qs.length) return;
  form.innerHTML = `<strong>Claude가 물어봐요</strong>${qs
    .map(
      (q, i) =>
        `<label for="q${i}">${esc(q.text)}</label>${
          q.options?.length
            ? `<select id="q${i}">${q.options.map((o) => `<option>${esc(o)}</option>`).join('')}<option value="">(모름/건너뛰기)</option></select>`
            : `<input type="text" id="q${i}" />`
        }`,
    )
    .join(
      '',
    )}<label class="small"><input type="checkbox" id="q-save" checked /> 답을 프로필에도 저장</label><div class="row"><button class="primary">답 보내기</button></div>`;
}

$<HTMLFormElement>('questions').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const qs: AskQuestion[] = state.questions;
  const answers = qs.map((q, i) => `- ${q.text}${q.path ? ` (${q.path})` : ''}: ${($<HTMLInputElement>(`q${i}`).value || '(모름, 건너뛰기)').trim()}`);
  const saveOk = $<HTMLInputElement>('q-save').checked;
  const prompt = `질문에 대한 답:\n${answers.join('\n')}\n${saveOk ? '답한 값은 save_profile로 프로필에 저장해도 돼요.' : '프로필에는 저장하지 마세요.'}\n이어서 채워 줘.`;
  void startRun(prompt, state.sessionId);
});

async function startRun(prompt: string, resume?: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  post({ t: 'run', tabId: tab.id, prompt, resume, model: $<HTMLSelectElement>('model').value || undefined });
}

$('fill').addEventListener('click', () => void startRun(FILL_PROMPT));
$('cancel').addEventListener('click', () => post({ t: 'cancel' }));
$('clear').addEventListener('click', () => post({ t: 'clear' }));
$<HTMLSelectElement>('model').addEventListener('change', (e) => void chrome.storage.local.set({ model: (e.target as HTMLSelectElement).value }));
void chrome.storage.local.get('model').then((v) => ($<HTMLSelectElement>('model').value = (v.model as string) ?? ''));

function onEvent(e: PanelEvent): void {
  switch (e.t) {
    case 'state':
      state = e.state;
      renderLog();
      renderQuestions();
      renderRunning();
      renderStatus(state.status);
      if (!state.status) post({ t: 'status' });
      break;
    case 'event':
      state.events.push(e.event);
      if (e.event.kind === 'start') state.running = true;
      if (e.event.kind === 'done') state.running = false;
      if (e.event.kind === 'run' && e.event.event.kind === 'init') state.sessionId = e.event.event.sessionId;
      if (e.event.kind === 'done' && e.event.done.sessionId) state.sessionId = e.event.done.sessionId;
      $('log').append(logItem(e.event));
      $('log').lastElementChild?.scrollIntoView({ block: 'nearest' });
      renderRunning();
      renderQuestions();
      break;
    case 'status':
      state.status = e.status;
      state.host = 'connected';
      renderStatus(e.status);
      renderRunning();
      break;
    case 'ask':
      state.questions = e.questions;
      renderQuestions();
      break;
    case 'host-down':
      state.host = 'down';
      renderStatus(undefined, e.error);
      break;
    case 'vault-locked':
      void renderVault();
      break;
    case 'host': {
      const m = e.msg;
      if (m.type === 'profile') {
        $<HTMLTextAreaElement>('profile').value = JSON.stringify(m.profile, null, 2);
        $('profile-msg').textContent = m.error ? `읽기 오류: ${m.error}` : m.path;
      } else if (m.type === 'profile-saved') $('profile-msg').textContent = m.ok ? '저장했어요' : `저장 안 됨: ${m.error}`;
      else if (m.type === 'login-output') $('status').append(document.createTextNode(m.text));
      else if (m.type === 'error') $('log').append(logItem({ kind: 'note', text: `⚠ ${m.message}`, at: Date.now() }));
      break;
    }
  }
}

// ── 파일 보관함 ──
async function renderFiles(): Promise<void> {
  const list = await listFiles();
  const ul = $('file-list');
  ul.innerHTML = list.length
    ? list
        .map(
          (f) =>
            `<li><span class="grow"><strong>${esc(f.kind)}</strong> ${esc(f.name)}<br><span class="small">${kb(f.size)}${f.issued ? ` · 발급 ${esc(f.issued)}` : ''}</span></span><button data-del="${esc(f.id)}">삭제</button></li>`,
        )
        .join('')
    : '<li class="small">보관한 파일이 없어요.</li>';
  for (const b of ul.querySelectorAll<HTMLButtonElement>('[data-del]')) {
    b.addEventListener('click', async () => {
      if (!confirm('이 파일을 보관함에서 지울까요?')) return;
      await removeFile(b.dataset.del!);
      void renderFiles();
    });
  }
}

$<HTMLFormElement>('file-add').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = $<HTMLInputElement>('file-input').files?.[0];
  if (!f) return;
  await addFile(f, $<HTMLSelectElement>('file-kind').value, $<HTMLInputElement>('file-issued').value);
  $<HTMLFormElement>('file-add').reset();
  void renderFiles();
});

// ── 계정 보관함 ──
async function loadVault(): Promise<VaultData | undefined> {
  return (await chrome.storage.local.get('vault')).vault as VaultData | undefined;
}

async function sessionKey(): Promise<CryptoKey | undefined> {
  const { vaultKey } = await chrome.storage.session.get('vaultKey');
  return typeof vaultKey === 'string' ? importKey(vaultKey) : undefined;
}

async function keepUnlocked(key: CryptoKey): Promise<void> {
  await chrome.storage.session.set({ vaultKey: await exportKey(key) });
  await chrome.alarms.create('vault-lock', { delayInMinutes: AUTO_LOCK_MIN });
}

async function renderVault(): Promise<void> {
  const box = $('vault');
  const data = await loadVault();
  const key = await sessionKey();
  if (!data) {
    box.innerHTML = `<form id="v-create" class="card"><strong>마스터 비밀번호 만들기</strong><div class="row"><input type="password" id="v-m1" placeholder="8자 이상" autocomplete="new-password" required /><input type="password" id="v-m2" placeholder="한 번 더" autocomplete="new-password" required /></div><p class="hint">잊으면 되찾을 수 없어요 (보관함을 지우고 다시 만들어야 해요).</p><button class="primary">만들기</button> <span id="v-msg" class="small"></span></form>`;
    $('v-create').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const m1 = $<HTMLInputElement>('v-m1').value;
      if (m1 !== $<HTMLInputElement>('v-m2').value) return void ($('v-msg').textContent = '두 비밀번호가 달라요');
      try {
        $('v-msg').textContent = '만드는 중…';
        const { data: d, key: k } = await createVault(m1);
        await chrome.storage.local.set({ vault: d });
        await keepUnlocked(k);
        void renderVault();
      } catch (e) {
        $('v-msg').textContent = e instanceof Error ? e.message : String(e);
      }
    });
  } else if (!key) {
    box.innerHTML = `<form id="v-unlock" class="card"><strong>잠김</strong><div class="row"><input type="password" id="v-m" placeholder="마스터 비밀번호" autocomplete="current-password" required /><button class="primary">잠금 풀기</button></div><span id="v-msg" class="small"></span><div class="row end"><button type="button" id="v-reset" class="link">보관함 지우기</button></div></form>`;
    $('v-unlock').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      $('v-msg').textContent = '확인 중…';
      const k = await unlockVault(data, $<HTMLInputElement>('v-m').value);
      if (!k) return void ($('v-msg').textContent = '비밀번호가 맞지 않아요');
      await keepUnlocked(k);
      void renderVault();
    });
    $('v-reset').addEventListener('click', async () => {
      if (!confirm('저장한 계정을 모두 지울까요? 되돌릴 수 없어요.')) return;
      await chrome.storage.local.remove('vault');
      void renderVault();
    });
  } else {
    box.innerHTML = `<div class="row"><span class="pill ok">열림 (${AUTO_LOCK_MIN}분 뒤 자동 잠금)</span><button id="v-lock">지금 잠그기</button></div>
      <ul class="list">${
        data.accounts.length
          ? data.accounts
              .map((a) => `<li><span class="grow"><strong>${esc(a.origin)}</strong><br><span class="small">${esc(a.username)}${a.label ? ` · ${esc(a.label)}` : ''}</span></span><button data-del="${esc(a.id)}">삭제</button></li>`)
              .join('')
          : '<li class="small">저장한 계정이 없어요.</li>'
      }</ul>
      <form id="v-add" class="card"><strong>계정 추가</strong>
        <input id="v-origin" placeholder="로그인 페이지 주소 (https://…)" required style="width:100%" />
        <div class="row"><input id="v-user" placeholder="아이디" autocomplete="off" required /><input type="password" id="v-pass" placeholder="비밀번호" autocomplete="new-password" required /></div>
        <button class="primary">암호화해서 저장</button> <span id="v-msg" class="small"></span></form>`;
    $('v-lock').addEventListener('click', async () => {
      await chrome.storage.session.remove('vaultKey');
      await chrome.alarms.clear('vault-lock');
      void renderVault();
    });
    for (const b of box.querySelectorAll<HTMLButtonElement>('[data-del]')) {
      b.addEventListener('click', async () => {
        if (!confirm('이 계정을 지울까요?')) return;
        data.accounts = data.accounts.filter((a) => a.id !== b.dataset.del);
        await chrome.storage.local.set({ vault: data });
        void renderVault();
      });
    }
    $('v-add').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await addAccount(data, key, { origin: $<HTMLInputElement>('v-origin').value, username: $<HTMLInputElement>('v-user').value, password: $<HTMLInputElement>('v-pass').value });
        $<HTMLInputElement>('v-pass').value = '';
        await chrome.storage.local.set({ vault: data });
        await keepUnlocked(key);
        void renderVault();
      } catch (e) {
        $('v-msg').textContent = e instanceof Error ? e.message : String(e);
      }
    });
  }
  const { loginLog = [] } = await chrome.storage.local.get('loginLog');
  $('login-log').innerHTML =
    (loginLog as { origin: string; status: string; at: string }[])
      .slice(-20)
      .reverse()
      .map((l) => `<li><span class="grow">${esc(l.origin)}</span><span class="small">${esc(l.status)} · ${esc(l.at.slice(0, 16).replace('T', ' '))}</span></li>`)
      .join('') || '<li class="small">없음</li>';
}

// ── 프로필 ──
$('profile-load').addEventListener('click', () => toHost({ type: 'profile-get' }));
$('profile-save').addEventListener('click', () => {
  try {
    toHost({ type: 'profile-save', profile: JSON.parse($<HTMLTextAreaElement>('profile').value) });
    $('profile-msg').textContent = '저장 중…';
  } catch (e) {
    $('profile-msg').textContent = `JSON 오류: ${e instanceof Error ? e.message : String(e)}`;
  }
});

connect();
