// 페이지에 주입되는 번들의 진입점. window.__clf 로 노출된다.
// Playwright 드라이버는 evaluate로 주입하고, 크롬 확장은 content script로 같은 코드를 쓴다.
import { buttonInfo, clickDom } from './actions.js';
import { scan } from './extract.js';
import {
  armSearch,
  clearMarks,
  confirmPick,
  dismiss,
  fieldStates,
  fill,
  inspect,
  listState,
  markOption,
  modalState,
  precheck,
  verify,
  watchState,
} from './fill.js';
import { attachFile } from './files.js';
import { detectLogin, fillLogin } from './login.js';
import { postcodePick, postcodeSearch, postcodeState } from './postcode.js';
import { attrOf, clickSelector, focusSel, frameOffset, pressKey, rectOf, setValueSelector, typeText } from './input.js';

const api = {
  build: '',
  scan,
  fill,
  precheck,
  inspect,
  markOption,
  armSearch,
  listState,
  confirmPick,
  dismiss,
  modalState,
  buttonInfo,
  clickDom,
  clearMarks,
  verify,
  fieldStates,
  watchState,
  clickSelector,
  setValueSelector,
  pressKey,
  typeText,
  attrOf,
  attachFile,
  detectLogin,
  fillLogin,
  postcodeState,
  postcodeSearch,
  postcodePick,
  rectOf,
  focusSel,
  frameOffset,
  html: () => document.documentElement.outerHTML,
};

export type ClfApi = typeof api;

(window as unknown as { __clf: ClfApi }).__clf = api;
