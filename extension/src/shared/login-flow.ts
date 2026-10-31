// 계정 보관함 로그인 흐름 (background가 chrome API를 넣어서 쓴다. 테스트는 가짜를 넣는다).
// 규칙: 인증 화면이면 멈춤 → 잠겨 있으면 멈춤 → 그 프레임 origin과 정확히 같은 계정만 → 한 번만 시도(계정 잠김 방지).
// 비밀번호는 fill() 안으로만 넘어가고, 결과·기록에는 상태만 남는다.
import type { LoginOutcome } from './protocol';
import { accountFor, open as openSealed, type VaultData } from './vault';

export interface LoginDetect {
  form: boolean;
  challenge?: string;
  origin: string;
}

export interface LoginDeps {
  detect(): Promise<{ frameId: number; result: LoginDetect }[]>;
  vault(): Promise<VaultData | undefined>;
  key(): Promise<CryptoKey | undefined>;
  /** 그 프레임에 넣고 로그인 버튼 누르기. content script가 origin을 한 번 더 확인한다 */
  fill(frameId: number, msg: { origin: string; username: string; password: string }): Promise<void>;
  /** 로그인 뒤 페이지가 가라앉을 때까지 */
  settle(): Promise<void>;
  url(): Promise<string>;
  log(origin: string, status: LoginOutcome['status']): Promise<void>;
}

export async function runLogin(d: LoginDeps): Promise<LoginOutcome> {
  const found = await d.detect();
  const ch = found.find((f) => f.result.challenge);
  if (ch) return { status: 'challenge', message: `${ch.result.challenge} 화면이에요. 직접 진행해 주세요.` };
  const target = found.find((f) => f.result.form);
  if (!target) return { status: 'no_form', message: '로그인 입력 칸을 찾지 못했어요.' };
  const vault = await d.vault();
  const key = await d.key();
  if (!vault || !key) return { status: 'locked', message: '계정 보관함이 잠겨 있어요. 사이드패널 [계정] 탭에서 잠금을 풀어 주세요.' };
  const acc = accountFor(vault, target.result.origin);
  if (!acc) {
    await d.log(target.result.origin, 'no_account');
    return { status: 'no_account', message: `${target.result.origin} 계정이 보관함에 없어요. 직접 로그인하거나 [계정] 탭에서 추가해 주세요.` };
  }
  const urlBefore = await d.url();
  try {
    await d.fill(target.frameId, { origin: acc.origin, username: acc.username, password: await openSealed(key, acc.secret) });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const status = /origin/i.test(m) ? 'domain_mismatch' : 'failed';
    await d.log(acc.origin, status);
    // 오류 문구에 값이 섞이지 않게 고정 문구만 돌려준다
    return { status, message: status === 'domain_mismatch' ? '주소가 저장된 계정과 달라서 넣지 않았어요.' : '로그인 칸에 넣지 못했어요. 직접 로그인해 주세요.' };
  }
  await d.settle();
  const after = await d.detect();
  const ch2 = after.find((f) => f.result.challenge);
  let out: LoginOutcome;
  if (ch2) out = { status: 'challenge', message: `로그인 뒤 ${ch2.result.challenge} 화면이 나왔어요. 직접 진행해 주세요.` };
  else if (!after.some((f) => f.result.form) || (await d.url()) !== urlBefore) out = { status: 'logged_in', message: '로그인했어요.' };
  else out = { status: 'failed', message: '로그인 화면이 그대로예요. 아이디·비밀번호가 맞는지 직접 확인해 주세요. (다시 시도하지 않아요)' };
  await d.log(acc.origin, out.status);
  return out;
}
