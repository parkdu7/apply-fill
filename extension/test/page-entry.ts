// 테스트용: content script(dom 번들 + 메시지 처리)를 페이지에 넣어 background 없이 부를 수 있게 한다.
import '../../fill-mcp/src/dom/index';
import { handleContent } from '../src/content/handlers';

(window as unknown as { __clfHandle: typeof handleContent }).__clfHandle = handleContent;
