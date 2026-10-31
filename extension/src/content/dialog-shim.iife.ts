// 페이지 world에서 alert/confirm/prompt를 감싼다.
// 에이전트가 동작하는 동안(content script가 <html data-clf-agent="1">로 표시)만 대신 처리한다:
// alert은 확인, confirm은 제출·삭제 계열이 아니면 확인(맞으면 취소), prompt는 취소.
// 사람이 직접 누른 버튼에서 뜬 창은 원래대로 뜬다. 기록은 content script로 보낸다(clf-dialog 이벤트, 문자열).
import { BLOCKED_DIALOG } from '../../../fill-mcp/src/dom/safety';

(() => {
  const w = window as unknown as { __clfShim?: boolean };
  if (w.__clfShim) return;
  w.__clfShim = true;
  const orig = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
  const active = () => document.documentElement?.dataset.clfAgent === '1';
  const record = (type: string, message: unknown, handled: string) => {
    const detail = JSON.stringify({ type, message: String(message ?? '').slice(0, 300), handled, at: Date.now() });
    document.dispatchEvent(new CustomEvent('clf-dialog', { detail }));
  };
  window.alert = function alert(message?: unknown) {
    if (active()) return record('alert', message, 'accepted');
    record('alert', message, 'user');
    return orig.alert.call(window, message);
  };
  window.confirm = function confirm(message?: string) {
    if (active()) {
      const ok = !BLOCKED_DIALOG.test(String(message ?? ''));
      record('confirm', message, ok ? 'accepted' : 'dismissed');
      return ok;
    }
    record('confirm', message, 'user');
    return orig.confirm.call(window, message);
  };
  window.prompt = function prompt(message?: string, def?: string) {
    if (active()) {
      record('prompt', message, 'dismissed');
      return null;
    }
    record('prompt', message, 'user');
    return orig.prompt.call(window, message, def);
  };
})();
