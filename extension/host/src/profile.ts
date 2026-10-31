// 사이드패널에서 프로필을 통째로 저장할 때 민감정보를 막는다 (fill-mcp save_profile과 같은 규칙).
import { looksSensitiveValue, SENSITIVE_LABEL } from '../../../fill-mcp/src/dom/safety';

/** 민감정보(주민번호·계좌·비밀번호 항목, 주민번호·카드번호 형식 값)가 있으면 그 경로 */
export function sensitivePaths(v: unknown, at = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => sensitivePaths(x, `${at}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => (SENSITIVE_LABEL.test(k) ? [`${at ? `${at}.` : ''}${k}`] : sensitivePaths(x, at ? `${at}.${k}` : k)));
  if (typeof v === 'string' && looksSensitiveValue(v, at)) return [at];
  return [];
}
