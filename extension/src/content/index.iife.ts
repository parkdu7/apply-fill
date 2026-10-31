// 모든 프레임에 들어가는 content script (격리된 world).
// fill-mcp의 dom 번들을 그대로 써서 window.__clf를 만들고, background가 보낸 호출을 실행한다.
import '../../../fill-mcp/src/dom/index';
import { handleContent, type ContentMsg } from './handlers';

const w = window as unknown as { __clfExt?: boolean };
if (!w.__clfExt) {
  w.__clfExt = true;
  chrome.runtime.onMessage.addListener((msg: ContentMsg, _sender, sendResponse) => {
    handleContent(msg).then(
      (result) => sendResponse({ ok: true, result }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });
}
