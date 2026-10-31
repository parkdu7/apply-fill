// 안전 규칙. 페이지 안과 Node 쪽에서 같은 정규식으로 이중 확인한다.
import type { ButtonKind } from './types.js';

/** 제출·확정 계열 버튼. 에이전트는 어떤 경우에도 누르지 않는다. */
export const BLOCKED_BUTTON =
  /제출|최종|지원\s*하기|지원\s*완료|접수|완료|확정|결제|탈퇴|삭제|로그\s*아웃|미리\s*보기|submit|apply|finish|confirm|delete|remove|log\s*out|sign\s*out|DeleteIcon|DeleteOutline|trash/i;

export const NEXT_BUTTON = /다음|next|계속/i;
export const SAVE_BUTTON = /임시\s*저장|저장/;
/** 편집 팝업 안에서 행을 확정하는 버튼 */
const ROW_SAVE_BUTTON = /^(저장|저장하기|등록|등록하기|적용|적용하기|입력|확인)$/;
/** 팝업 없이 섹션 안 입력 줄을 확정하는 버튼 (ninehire "입력사항 저장") */
const INLINE_ROW_SAVE_BUTTON = /^입력\s*(사항)?\s*저장$/;
export const ADD_BUTTON = /추가|add|^\+|\+$/i;
// 아이콘 버튼은 "수정 pencil"처럼 아이콘 이름이 같이 들어온다
const EDIT_BUTTON = /(^|\s)(수정|수정하기|편집)(\s|$)|pencil|EditIcon|^edit$/i;
export const SEARCH_BUTTON = /검색|찾기|조회|search/i;
/** 확인창 안의 "확인/예" 버튼: 확인창 글자가 제출 계열이면 이 버튼도 막는다 */
export const CONFIRM_BUTTON = /^(확인|예|네|ok|yes)$/i;

/** 동의·서약 체크박스는 사람이 직접 읽고 체크한다. */
export const CONSENT_LABEL = /동의|서약|확인하였|확인했|약관|consent|agree/i;

/** 민감정보: 입력도, 프로필 저장도 하지 않는다. */
export const SENSITIVE_LABEL =
  /주민|외국인\s*등록|계좌|비밀\s*번호|패스워드|password|여권\s*번호|카드\s*번호|cvc|보안\s*코드/i;

/** 시험·자격증 번호는 카드번호와 자릿수가 비슷해서 카드번호 검사에서 뺀다 (TOEIC 수험번호 16자리 등) */
const NUMBER_FIELD = /수험|응시|등록\s*번호|자격|인증|증명|발급|면허|사업자|학번|군번|회원|접수/;

function luhn(ds: string): boolean {
  let sum = 0;
  for (let i = 0; i < ds.length; i++) {
    let d = Number(ds[ds.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** 주민번호(앞 6자리가 날짜로 말이 되는 것)나 카드번호(Luhn 검사 통과)처럼 보이는 값 */
export function looksSensitiveValue(value: string, label = ''): boolean {
  for (const m of value.matchAll(/(?:^|\D)\d{2}(\d{2})(\d{2})-?[1-8]\d{6}(?=\D|$)/g)) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return true;
  }
  if (NUMBER_FIELD.test(label)) return false;
  for (const m of value.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const ds = m[0].replace(/\D/g, '');
    if (ds.length >= 13 && luhn(ds)) return true;
  }
  return false;
}

/** 다른 페이지로 넘어가거나 제출로 이어지는 대화상자 문구 */
export const BLOCKED_DIALOG = /제출|최종|접수|지원\s*하시겠|확정|삭제|결제|탈퇴/;

/**
 * 버튼 분류. dialogText가 있으면 편집 팝업/확인창 안의 버튼이다.
 * 팝업 안 "저장하기"는 행 확정(rowsave)이고, 확인창 글자가 제출 계열이면 그 "확인"도 막는다.
 */
export function classifyButtonText(text: string, dialogText?: string): ButtonKind {
  const t = text.trim();
  if (BLOCKED_BUTTON.test(t)) return 'blocked';
  if (dialogText !== undefined) {
    if (CONFIRM_BUTTON.test(t) && BLOCKED_DIALOG.test(dialogText)) return 'blocked';
    if (ROW_SAVE_BUTTON.test(t)) return 'rowsave';
  }
  if (NEXT_BUTTON.test(t)) return 'next';
  if (INLINE_ROW_SAVE_BUTTON.test(t)) return 'rowsave';
  if (SAVE_BUTTON.test(t)) return dialogText !== undefined ? 'rowsave' : 'save';
  if (t.length <= 12 && ADD_BUTTON.test(t)) return 'add';
  if (EDIT_BUTTON.test(t)) return 'edit';
  if (SEARCH_BUTTON.test(t)) return 'search';
  return 'other';
}
