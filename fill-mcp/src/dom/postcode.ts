// 주소 검색 팝업(다음/카카오 우편번호 서비스) 안에서 쓰는 함수.
// 이 프레임이 우편번호 검색 화면인지 알아보고, 검색어를 넣어 검색하고, 결과 중 하나를 누른다.
// 실제 서비스 화면 구조는 확인하지 못해서(기획서 P5) 구조로 찾는다: 예시 placeholder("예) 판교역로 166")가 있는 검색 칸 + 결과 목록.
import { clean, fireChange, fireInput, pointerClick, setNativeValue, visible } from './util.js';

const POSTCODE_HOST = /postcode\.map\.(daum|kakao)\.net|postcode\.map\.kakao\.com|t1\.daumcdn\.net\/postcode|spi\.maps\.daum\.net\/postcode/i;
const EXAMPLE_PH = /예\)|도로명|지번|건물명|판교역로|동\/읍\/면/;

function searchInput(): HTMLInputElement | null {
  const byId = document.querySelector<HTMLInputElement>('#region_name, input[name="region_name"]');
  if (byId) return byId;
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="search"], input:not([type])')).find((i) => EXAMPLE_PH.test(i.placeholder)) ?? null;
}

interface ResultItem {
  el: HTMLElement;
  /** 누를 링크 (도로명 주소) */
  link: HTMLElement;
  text: string;
}

function results(): ResultItem[] {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.list_post > li, .list_post li, ul.post_list > li, [class*="result"] li, ol li, ul li'));
  const out: ResultItem[] = [];
  for (const el of items) {
    const link = el.querySelector<HTMLElement>('.main_road a, .link_post, a, button');
    const text = clean(el.textContent ?? '');
    // 우편번호(5자리)나 "도로명"이 있는 줄만 결과로 친다
    if (!link || !/\b\d{5}\b|도로명|지번/.test(text)) continue;
    if (out.some((o) => o.el.contains(el) || el.contains(o.el))) continue;
    out.push({ el, link, text: text.slice(0, 160) });
  }
  return out;
}

export interface PostcodeState {
  isPostcode: boolean;
  results: string[];
  /** "검색결과가 없습니다" 같은 안내 */
  notice?: string;
}

export function postcodeState(): PostcodeState {
  const input = searchInput();
  const isPostcode = POSTCODE_HOST.test(location.href) || (!!input && /우편번호|도로명|지번/.test(document.body?.textContent ?? ''));
  if (!isPostcode) return { isPostcode: false, results: [] };
  const noticeEl = Array.from(document.querySelectorAll('.txt_noresult, .no_result, [class*="noresult" i], [class*="empty" i]')).find((e) => visible(e));
  const notice = clean(noticeEl?.textContent ?? '') || undefined;
  return { isPostcode, results: results().map((r) => r.text), notice };
}

/** 검색어를 넣고 검색 (검색 버튼 → 없으면 form 제출 → Enter) */
export function postcodeSearch(query: string): boolean {
  const input = searchInput();
  if (!input) throw new Error('주소 검색 칸을 찾지 못했어요');
  input.focus();
  setNativeValue(input, query);
  fireInput(input, query);
  fireChange(input);
  const form = input.form;
  const btn =
    (form ?? document).querySelector<HTMLElement>('.btn_search, button[type="submit"], input[type="submit"], button[class*="search" i]') ??
    Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => /검색|찾기/.test(b.textContent ?? ''));
  if (btn) pointerClick(btn);
  else if (form) form.requestSubmit();
  else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  return true;
}

/** index번째 결과(0부터)의 도로명 주소를 누른다 */
export function postcodePick(index: number): string {
  const r = results()[index];
  if (!r) throw new Error(`${index + 1}번째 결과가 없어요`);
  pointerClick(r.link);
  return r.text;
}
