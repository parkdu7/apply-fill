// 로그인 화면 알아보기와 계정 보관함 로그인 입력 (확장 전용).
// - CAPTCHA·2단계 인증(인증번호/OTP)·본인인증 화면이면 challenge로 알려서 멈추게 한다 (자동으로 풀지 않는다)
// - fillLogin은 확장 background가 이 프레임 origin에 묶인 계정만 넘길 때만 불린다. 비밀번호는 돌려주지도 기록하지도 않는다
import { textOf, visible, fireChange, fireInput, pointerClick, setNativeValue, clean } from './util.js';

export interface LoginDetect {
  form: boolean;
  challenge?: string;
  origin: string;
}

const CAPTCHA =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[title*="reCAPTCHA" i], .g-recaptcha, .h-captcha, .cf-turnstile, [class*="captcha" i], [id*="captcha" i], img[alt*="보안문자"], img[alt*="captcha" i]';
const CAPTCHA_TEXT = /보안\s*문자|자동\s*입력\s*방지|자동가입방지|로봇이\s*아닙니다|I'?m not a robot/i;
const OTP_LABEL = /인증\s*번호|OTP|일회용\s*(비밀번호|코드)|2단계\s*인증|보안\s*코드|verification\s*code|one[-\s]?time/i;
const IDENTITY = /본인\s*(인증|확인)|휴대폰\s*(본인\s*)?인증|PASS\s*인증|아이핀|i-?PIN|공동\s*인증서|간편\s*인증/i;
const LOGIN_BUTTON = /^(로그인|log\s*in|sign\s*in|login)$/i;
const USER_HINT = /아이디|이메일|id|user|login|email|account|계정/i;

function passwordInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter((i) => visible(i) && !i.disabled);
}

function container(el: HTMLElement): HTMLElement {
  return el.closest('form') ?? el.closest('[class*="login" i], [id*="login" i], section, main') ?? document.body;
}

function usernameFor(pw: HTMLInputElement): HTMLInputElement | null {
  const box = container(pw);
  const inputs = Array.from(box.querySelectorAll<HTMLInputElement>('input')).filter(
    (i) => visible(i) && !i.disabled && /^(text|email|tel|)$/.test(i.type) && i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  // 아이디 같아 보이는 것, 없으면 비밀번호 바로 앞 칸
  return inputs.find((i) => USER_HINT.test(`${i.name} ${i.id} ${i.placeholder} ${i.autocomplete} ${i.getAttribute('aria-label') ?? ''}`)) ?? inputs[inputs.length - 1] ?? null;
}

function challenge(hasForm: boolean): string | undefined {
  // reCAPTCHA v3 배지(.grecaptcha-badge)는 로그인을 막지 않는다
  const cap =
    Array.from(document.querySelectorAll<HTMLElement>(CAPTCHA)).some((e) => visible(e) && !e.closest('.grecaptcha-badge')) || CAPTCHA_TEXT.test(textOf(document.body, 4000));
  if (cap) return 'CAPTCHA(자동입력 방지)';
  // 로그인 화면에는 "휴대폰 인증으로 아이디 찾기" 같은 링크가 흔하다: 비밀번호 칸이 없을 때만 인증 화면으로 본다
  if (hasForm) return undefined;
  const otp = Array.from(document.querySelectorAll<HTMLInputElement>('input')).find(
    (i) =>
      visible(i) &&
      (i.autocomplete === 'one-time-code' || OTP_LABEL.test(`${i.placeholder} ${i.name} ${i.id} ${i.getAttribute('aria-label') ?? ''} ${Array.from(i.labels ?? []).map((l) => l.textContent).join(' ')}`)),
  );
  if (otp) return '2단계 인증(인증번호)';
  const heads = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, button, [role="button"], legend, .title, [class*="title" i]')).filter((e) => visible(e));
  if (heads.some((h) => IDENTITY.test(clean(h.textContent ?? '')))) return '본인인증';
  return undefined;
}

export function detectLogin(): LoginDetect {
  const pws = passwordInputs();
  // 비밀번호 칸이 둘 이상이면 가입·비밀번호 변경 화면이다
  const form = pws.length === 1 && !!usernameFor(pws[0]);
  return { form, challenge: challenge(form), origin: location.origin };
}

function loginButton(box: HTMLElement): HTMLElement | null {
  const cands = Array.from(box.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]')).filter((b) => visible(b));
  return (
    cands.find((b) => LOGIN_BUTTON.test(clean(b.textContent || (b as HTMLInputElement).value || ''))) ??
    cands.find((b) => (b as HTMLButtonElement).type === 'submit') ??
    null
  );
}

/** 아이디·비밀번호를 넣고 로그인 버튼을 누른다. 결과(로그인 됐는지)는 background가 다시 detectLogin으로 본다 */
export function fillLogin(username: string, password: string): { submitted: boolean } {
  const d = detectLogin();
  if (d.challenge) throw new Error(`${d.challenge} 화면이에요`);
  if (!d.form) throw new Error('로그인 입력 칸을 찾지 못했어요');
  const pw = passwordInputs()[0];
  const user = usernameFor(pw)!;
  for (const [el, v] of [
    [user, username],
    [pw, password],
  ] as const) {
    el.focus();
    setNativeValue(el, v);
    fireInput(el, v);
    fireChange(el);
  }
  const btn = loginButton(container(pw));
  if (btn) pointerClick(btn);
  else if (pw.form) pw.form.requestSubmit();
  else pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  return { submitted: true };
}
