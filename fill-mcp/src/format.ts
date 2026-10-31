// 툴 결과를 LLM이 읽기 좋은 짧은 텍스트로. JSON보다 토큰이 훨씬 적게 든다.
import type { SiteAdapter } from './adapters.js';
import type { ActionButton, ButtonKind, Field, FillOutcome, ManualReason, PageScan } from './dom/types.js';
import type { VaultFile } from './bridge.js';
import type { AddressResult, AddRowsResult, AttachItemResult, ChangedField, ClickResult, FillResult, NavResult, ResetInfo, ScanResult, WaitResult } from './driver.js';
import type { DialogRecord, TabInfo } from './transport.js';

const MANUAL_TEXT: Record<ManualReason, string> = {
  file: '파일 첨부',
  password: '비밀번호',
  sensitive: '민감정보',
  essay: '자기소개서 (직접 작성)',
  consent: '동의/서약 (직접 확인)',
  readonly: '읽기 전용 (검색 팝업 등)',
  disabled: '비활성 (앞 항목 선택 필요하거나 자동 입력됨)',
  address: '직접 입력: 주소 검색 팝업 (입력 칸이 아니라 팝업으로만 들어감, 사용자에게 안내)',
  popup: '직접 입력: 검색 팝업 (입력 칸이 아님, 사용자에게 안내)',
};

const BUTTON_TEXT: Record<ButtonKind, string> = {
  next: '다음',
  save: '전체저장',
  rowsave: '행저장',
  add: '추가',
  edit: '수정',
  search: '검색',
  tab: '탭',
  other: '기타',
  blocked: '차단',
};

const STATUS_MARK: Record<FillOutcome['status'], string> = {
  ok: '✓',
  mismatch: '✗ 불일치',
  skipped: '– 건너뜀',
  refused: '⛔ 거부',
  auto: '⏳ 자동 채움',
  not_found: '? 못 찾음',
  error: '! 오류',
};

const HANDLED_TEXT: Record<DialogRecord['handled'], string> = {
  accepted: '확인 누름',
  dismissed: '취소 누름',
  user: '사용자에게 맡김',
};

export function renderField(f: Field): string {
  let s = `${f.key} ${f.kind} "${f.label || '(라벨 없음)'}"`;
  if (f.nth) s += ` #${f.nth}`;
  if (f.part) s += ` (칸 ${f.part})`;
  if (f.required) s += ' *필수';
  if (f.options) s += ` [${f.options.join(' | ')}${f.moreOptions ? ` | …외 ${f.moreOptions}개` : ''}]`;
  if (f.placeholder) s += ` ph="${f.placeholder}"`;
  if (f.maxLength) s += ` max=${f.maxLength}`;
  if (f.hint) s += ` hint="${f.hint}"`;
  if (f.value !== undefined && !(f.kind === 'checkbox' && f.value === 'false')) s += ` =${JSON.stringify(f.value)}`;
  if (f.filledByAgent) s += ' (에이전트 입력)';
  return s;
}

function renderButton(b: ActionButton): string {
  return `${b.key} [${BUTTON_TEXT[b.kind]}] "${b.text}"${b.section ? ` (${b.section})` : ''}`;
}

/** 기타 버튼은 한 줄에 몰아서 (호출마다 수십 개가 다시 나와 사용량을 많이 먹는다) */
function renderButtons(buttons: ActionButton[]): string[] {
  const main = buttons.filter((b) => b.kind !== 'other');
  const others = buttons.filter((b) => b.kind === 'other');
  const lines = main.map(renderButton);
  if (others.length) lines.push(`[기타] ${others.map((b) => `${b.key} "${b.text}"`).join(', ')}`);
  return lines;
}

function renderChanged(changed: ChangedField[], title: string): string[] {
  if (!changed.length) return [];
  const mine = changed.filter((c) => c.field.filledByAgent);
  const lines = ['', `${title} ${changed.length}개${mine.length ? ` (⚠ 에이전트가 넣은 칸 ${mine.length}개 — 프로필 값과 다르면 다시 넣기)` : ''}:`];
  for (const c of [...mine, ...changed.filter((x) => !x.field.filledByAgent)]) {
    lines.push(`${c.field.filledByAgent ? '⚠ ' : ''}${c.field.key} "${c.field.label}": ${JSON.stringify(c.from)} → ${JSON.stringify(c.field.value ?? '')}`);
  }
  return lines;
}

function renderDialogs(dialogs: DialogRecord[]): string[] {
  if (!dialogs.length) return [];
  return ['', '브라우저 알림창:', ...dialogs.map((d) => `- [${d.type}] ${d.message} (${HANDLED_TEXT[d.handled]})`)];
}

function renderModal(m: NonNullable<PageScan['modal']>): string[] {
  if (m.editing) {
    return [`※ 편집 팝업 "${m.title}"이 열려 있어 팝업 안만 보여줍니다. [행저장] 버튼을 눌러야 이 행이 남아요.`];
  }
  return [`※ 안내창이 떠 있어요: "${m.text}"`, '  (입력 칸이 없는 안내/확인창이에요. 내용을 보고 확인·닫기를 누르거나 사용자에게 알리세요)'];
}

/** 어댑터: 이 사이트(ATS)에서 배워 둔 것. 팝업 라벨을 처음부터 알면 일부러 실패시켜 알아낼 필요가 없다 */
export function renderAdapter(a: SiteAdapter): string[] {
  const lines = ['', `## 이 사이트에서 배운 것 (어댑터 ${a.ats ?? a.site})`];
  for (const n of a.notes ?? []) lines.push(`- ${n}`);
  for (const [title, sec] of Object.entries(a.sections ?? {})) {
    const parts: string[] = [];
    if (sec.fields?.length) parts.push(`팝업 칸: ${sec.fields.join(', ')}`);
    if (sec.labels && Object.keys(sec.labels).length) parts.push(`라벨: ${Object.entries(sec.labels).map(([k, v]) => `${k}→${v}`).join(', ')}`);
    if (sec.maxRows) parts.push(`최대 ${sec.maxRows}개 (넘는 항목은 처음부터 고르고 뺀 것을 보고)`);
    if (sec.order?.length) parts.push(`먼저 넣을 칸: ${sec.order.join(', ')}`);
    if (sec.resets) parts.push(...Object.entries(sec.resets).map(([k, v]) => `"${k}"을(를) 넣으면 ${v.join(', ')}이(가) 비워짐`));
    if (sec.requiredFiles?.length) parts.push(`필수 첨부: ${sec.requiredFiles.join(', ')}`);
    if (sec.external) parts.push(`외부 연동: ${Object.entries(sec.external).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (parts.length) lines.push(`- ${title}: ${parts.join(' · ')}`);
  }
  if (a.values && Object.keys(a.values).length) lines.push(`- 값: ${Object.entries(a.values).map(([k, v]) => `${k}→${v}`).join(', ')}`);
  return lines.length > 2 ? lines : [];
}

function renderResets(resets: ResetInfo[] | undefined, indent = ''): string[] {
  return (resets ?? []).map((r) => `${indent}⚠ "${r.by}"을(를) 넣자 ${r.cleared.join(', ')}이(가) 비워져서 다시 넣었어요`);
}

export function renderScan(s: ScanResult): string {
  const lines: string[] = [`페이지: ${s.title || '(제목 없음)'} — ${s.url}`];
  if (s.modal) lines.push(...renderModal(s.modal));
  const fillable = s.fields.filter((f) => !f.manual);
  const manual = s.fields.filter((f) => f.manual);
  const withValue = fillable.filter((f) => f.value !== undefined && f.value !== '' && f.value !== 'false');
  lines.push(`입력 칸 ${fillable.length}개 (이미 값 있음 ${withValue.length}) · 직접 처리 ${manual.length}개${s.frames > 1 ? ` · 프레임 ${s.frames}개` : ''}`);
  if (s.omitted) lines.push(`(바뀐 것만 보여줘요: 그대로인 칸 ${s.omitted.fields}개·버튼 ${s.omitted.buttons}개 생략)`);
  // 에이전트가 넣고 확인까지 끝난 칸은 섹션마다 키만 한 줄로 접는다
  let section: string | undefined;
  let done: string[] = [];
  const flush = () => {
    if (done.length) lines.push(`✓ 에이전트 입력 ${done.length}칸: ${done.join(', ')}`);
    done = [];
  };
  for (const f of fillable) {
    if (f.section !== section || section === undefined) {
      flush();
      section = f.section ?? '';
      lines.push('', `## ${section || '(섹션 없음)'}`);
    }
    if (f.filledByAgent && f.value !== undefined && f.value !== '' && f.value !== 'false') done.push(f.key);
    else lines.push(renderField(f));
  }
  flush();
  if (manual.length) {
    lines.push('', '## 직접 처리 필요 (fill_fields 불가)');
    for (const f of manual) lines.push(`${renderField(f)} — ${MANUAL_TEXT[f.manual!]}`);
  }
  if (s.cards?.length) {
    lines.push('', '## 반복 섹션 (add_rows로 추가)');
    for (const c of s.cards) {
      const head = `- ${c.title}: ${c.rows.length ? `저장된 행 ${c.rows.length}개` : '저장된 행 없음'}${c.addKey ? ` · 추가 ${c.addKey}` : ''}`;
      lines.push(head);
      for (const r of c.rows) lines.push(`    ${r.editKey ? `[수정 ${r.editKey}] ` : ''}${r.text}`);
    }
  }
  const cardButtons = new Set((s.cards ?? []).flatMap((c) => [c.addKey, ...c.rows.map((r) => r.editKey)]));
  const usable = s.buttons.filter((b) => b.kind !== 'blocked' && !cardButtons.has(b.key));
  const blocked = s.buttons.filter((b) => b.kind === 'blocked');
  if (usable.length) lines.push('', '## 버튼', ...renderButtons(usable));
  if (blocked.length) lines.push('', `⛔ 누르지 않는 버튼(제출·삭제 계열): ${blocked.map((b) => `"${b.text}"`).join(', ')}`);
  if (s.adapter && !s.omitted) lines.push(...renderAdapter(s.adapter));
  if (s.files) lines.push(...renderFiles(s.files));
  if (s.login?.challenge) lines.push('', `⛔ ${s.login.challenge} 화면이에요. 자동으로 진행하지 않아요 — 사용자에게 직접 해 달라고 안내하고 wait_for_user로 기다리세요.`);
  else if (s.login?.form) lines.push('', '로그인 화면이에요. login 도구(확장의 계정 보관함, 저장된 계정이 있을 때만)로 로그인하거나 사용자에게 직접 로그인해 달라고 하세요.');
  if (s.external?.length && !s.omitted) {
    lines.push('', '외부 연동 (자동으로 하지 않음 — 사용자에게 안내하고 wait_for_user로 기다린 뒤 결과를 프로필과 비교):');
    for (const e of s.external) lines.push(`- ${e.name}${e.button ? `: 버튼 ${e.button}` : ''}${e.watch.length ? ` → 결과 칸 ${e.watch.join(', ')}` : ''}`);
  }
  if (!s.fields.length && !s.modal && !s.omitted) lines.push('', '입력 칸이 없어요. 로그인 화면이거나 지원서 페이지가 아닐 수 있어요.');
  return lines.join('\n');
}

function renderOutcomes(outcomes: FillOutcome[]): string[] {
  const count = (st: FillOutcome['status']) => outcomes.filter((o) => o.status === st).length;
  const lines = [
    `입력 결과: 성공 ${count('ok')} · 불일치 ${count('mismatch')} · 건너뜀 ${count('skipped')} · 거부 ${count('refused')}${count('auto') ? ` · 자동 채움 ${count('auto')}` : ''} · 못 찾음 ${count('not_found')} · 오류 ${count('error')}`,
  ];
  const quietOk = outcomes.filter((o) => o.status === 'ok' && !o.message);
  if (quietOk.length) lines.push(`✓ ${quietOk.map((o) => o.key).join(', ')}`);
  for (const o of outcomes) {
    if (o.status === 'ok' && !o.message) continue;
    const actual = o.actual !== undefined ? ` 실제=${JSON.stringify(o.actual)}` : '';
    lines.push(`${STATUS_MARK[o.status]} ${o.key} "${o.label ?? ''}"${actual}${o.message ? ` — ${o.message}` : ''}`);
  }
  return lines;
}

export function renderFill(r: FillResult): string {
  const lines = renderOutcomes(r.outcomes);
  lines.push(...renderResets(r.resets));
  if (r.stopped) lines.push('', `⚠ ${r.stopped}`);
  if (r.clicked) {
    if (r.clicked.error) lines.push('', `저장 버튼: ${r.clicked.error}`);
    else lines.push('', `"${r.clicked.text}" 눌렀어요${r.clicked.closedModal ? ' — 팝업이 닫혀 행이 저장됐어요' : ''}.`);
  }
  lines.push(...renderDialogs(r.dialogs));
  if (r.newFields.length) {
    lines.push('', `입력 후 새로 나타난 칸 ${r.newFields.length}개:`, ...r.newFields.map(renderField));
  }
  lines.push(...renderChanged(r.changedFields, '입력 뒤 값이 바뀐 다른 칸'));
  return lines.join('\n');
}

export function renderAddRows(r: AddRowsResult): string {
  const saved = r.rows.filter((x) => x.saved).length;
  const lines = [`행 추가: ${r.requested}개 중 ${saved}개 저장`];
  for (const row of r.rows) {
    const bad = row.outcomes.filter((o) => o.status !== 'ok' || o.message);
    const done = row.inline ? ' 입력됨 (페이지 안에 펼친 줄 — 단계 저장/다음 때 같이 저장돼요)' : ' 저장됨';
    const head = `${row.saved ? '✓' : '✗'} ${row.index}행${row.saved ? done : ''} (칸 ${row.outcomes.length}개)`;
    lines.push(head);
    if (row.saved && row.partial?.length) lines.push(`   ⚠ 부분 저장 — 보낸 값이 안 들어간 칸: ${row.partial.join(', ')} (사용자에게 확인 요청)`);
    for (const o of bad) lines.push(`   ${STATUS_MARK[o.status]} ${o.key} "${o.label ?? ''}"${o.actual !== undefined ? ` 실제=${JSON.stringify(o.actual)}` : ''}${o.message ? ` — ${o.message}` : ''}`);
    lines.push(...renderResets(row.resets, '   '));
    if (row.attached?.length) lines.push(`   📎 보관함에서 첨부: ${row.attached.join(', ')}`);
    if (row.unmatched.length) lines.push(`   못 찾은 라벨: ${row.unmatched.join(', ')}`);
  }
  if (r.maxRows) lines.push('', `최대 행 수: ${r.maxRows}개${r.skippedRows?.length ? ` — 넣지 못한 행: ${r.skippedRows.join(', ')}번 (뺀 항목으로 보고)` : ''}`);
  if (r.stopped) lines.push('', `⚠ 멈춤: ${r.stopped}`);
  if (r.openFields?.length) {
    const title = r.inline
      ? '새로 펼쳐진 줄의 칸 (fill_fields로 고치세요, 저장 버튼은 없어요):'
      : `열려 있는 팝업의 칸 (fill_fields로 고친 뒤 then_click: "${r.saveKey ?? '저장 버튼 키'}"):`;
    lines.push('', title, ...r.openFields.map(renderField));
  }
  for (const n of r.notices) if (n) lines.push('', `알림: ${n}`);
  lines.push(...renderDialogs(r.dialogs));
  if (r.savedRows) {
    lines.push('', `지금 "${r.savedRows.title}"에 저장된 행 ${r.savedRows.rows.length}개:`, ...r.savedRows.rows.map((t) => `- ${t}`));
  }
  return lines.join('\n');
}

export function renderClick(r: ClickResult): string {
  if (!r.ok) return [`버튼을 누르지 않았어요: ${r.message}`, ...renderDialogs(r.dialogs)].join('\n');
  const lines = [`"${r.text}" ${r.clicks}번 눌렀어요.${r.message ? ` ${r.message}` : ''}`];
  if (r.modal) lines.push(...renderModal(r.modal));
  if (r.newFields.length) lines.push('', `새로 생긴 칸 ${r.newFields.length}개:`, ...r.newFields.map(renderField));
  else if (!r.switchedTab) lines.push('새로 생긴 칸은 없어요.');
  if (r.newButtons.length) lines.push('', '새로 생긴 버튼:', ...renderButtons(r.newButtons));
  lines.push(...renderChanged(r.changedFields, '누른 뒤 값이 바뀐 칸'));
  lines.push(...renderDialogs(r.dialogs));
  return lines.join('\n');
}

export function renderNav(r: NavResult): string {
  if (!r.ok) return [`이동하지 않았어요: ${r.message}`, ...renderDialogs(r.dialogs)].join('\n');
  const lines = [`"${r.text}"을(를) 눌렀어요.`];
  if (r.switchedTab) lines.push(`새 탭/창으로 전환: ${r.title} — ${r.url}`);
  else if (r.navigated) lines.push(`이동: ${r.title} — ${r.url}`);
  else lines.push('주소는 그대로예요 (같은 페이지 안에서 단계가 바뀌었을 수 있음).');
  lines.push('extract_fields로 지금 화면의 칸을 확인하세요.');
  lines.push(...renderDialogs(r.dialogs));
  return lines.join('\n');
}

export function renderTabs(tabs: TabInfo[]): string {
  return tabs.map((t) => `${t.active ? '▶' : ' '} [${t.index}] ${t.title || '(제목 없음)'} — ${t.url}`).join('\n');
}

export function renderWait(r: WaitResult, reason: string): string {
  const lines = [
    r.timedOut
      ? `"${reason}" — ${r.waitedSec}초 기다렸지만 화면에 변화가 없어요. 사용자에게 진행 상황을 물어보세요.`
      : `"${reason}" — 사용자 작업을 감지해서 이어서 진행해요 (${r.waitedSec}초): ${r.changes.join(', ')}`,
  ];
  if (r.modal) lines.push(...renderModal(r.modal));
  if (r.newFields.length) lines.push('', `새로 생긴 칸 ${r.newFields.length}개:`, ...r.newFields.map(renderField));
  lines.push(...renderChanged(r.changedFields, '값이 바뀐 칸'));
  lines.push(...renderDialogs(r.dialogs));
  return lines.join('\n');
}

export function renderFiles(files: VaultFile[]): string[] {
  if (!files.length) return ['', '파일 보관함: 비어 있어요 (업로드 칸은 사용자가 직접 첨부하거나, 사이드패널 [파일]에 넣은 뒤 attach_files)'];
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);
  return [
    '',
    `파일 보관함 (${files.length}개, attach_files로 업로드 칸에 첨부):`,
    ...files.map((f) => `- ${f.id.slice(0, 8)} [${f.kind}] ${f.name} ${kb(f.size)}${f.issued ? ` 발급 ${f.issued}` : ''}`),
  ];
}

export function renderAttach(r: { results: AttachItemResult[]; files: VaultFile[] }): string {
  if (!r.results.length) return renderFiles(r.files).join('\n').trim();
  const lines = r.results.map((x) =>
    x.ok
      ? `✓ ${x.key} "${x.label ?? ''}" ← ${x.file}${x.shown ? ' (페이지에 이름 보임)' : ''}${x.message ? ` — ${x.message}` : ''}`
      : `✗ ${x.key} "${x.label ?? ''}"${x.file ? ` ← ${x.file}` : ''} — ${x.message ?? '실패'}`,
  );
  return [`첨부 결과: 성공 ${r.results.filter((x) => x.ok).length} · 실패 ${r.results.filter((x) => !x.ok).length}`, ...lines].join('\n');
}

export function renderAddress(r: AddressResult): string {
  const lines = [r.ok ? `✓ 주소를 골랐어요: ${r.picked}` : `✗ ${r.message ?? '주소를 넣지 못했어요'}`];
  if (r.ok && r.message) lines.push(r.message);
  if (r.results?.length) lines.push('', '검색 결과:', ...r.results.map((t, i) => `${i + 1}. ${t}`));
  lines.push(...renderChanged(r.changedFields, '값이 바뀐 칸'));
  if (r.newFields.length) lines.push('', `새로 생긴 칸 ${r.newFields.length}개:`, ...r.newFields.map(renderField));
  lines.push(...renderDialogs(r.dialogs));
  return lines.join('\n');
}
