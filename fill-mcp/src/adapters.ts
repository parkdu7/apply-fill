// 사이트 어댑터 캐시: 사이트(또는 같은 ATS를 쓰는 회사들)마다 배운 것을 저장해 두고 다음 채우기에 쓴다.
// - 기본 어댑터(adapters/*.json, 패키지에 포함): 실사용 메모에서 옮긴 것 (careerlink, ninehire, woowayouths …)
// - 배운 어댑터(data/adapters/*.json, 개인 데이터): 팝업 칸 라벨, 라벨 매핑, 최대 행 수, 초기화를 일으키는 칸
// 같은 ATS(careerlink 등)는 회사가 달라도 ATS 단위로 공유한다. 사이트 단위 어댑터가 있으면 그게 우선이다.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ButtonKind, ManualReason } from './dom/types.js';

export interface SectionAdapter {
  /** 프로필 키 → 팝업 라벨 ("입학일" → "재학기간(시작일)") */
  labels?: Record<string, string>;
  /** 팝업에서 본 칸 라벨 (add_rows 행 라벨을 처음부터 맞게 쓰도록) */
  fields?: string[];
  /** 먼저 넣어야 하는 칸 (토글이 뒤 칸을 비우는 순서) */
  order?: string[];
  /** 이 칸을 넣으면 비워지는 칸들 */
  resets?: Record<string, string[]>;
  maxRows?: number;
  /** 저장하려면 첨부가 필요한 파일 */
  requiredFiles?: string[];
  /** 외부 연동으로만 넣는 값 (TOEIC → ybm) */
  external?: Record<string, string>;
}

export interface SiteAdapter {
  /** 저장 키: ATS 이름 또는 호스트 */
  site: string;
  ats?: string;
  /** LLM에게 그대로 보여 줄 사이트 메모 */
  notes?: string[];
  sections?: Record<string, SectionAdapter>;
  /** 사이트 선택지 값 바꾸기 (프로필 값 → 사이트 값) */
  values?: Record<string, string>;
  /** 버튼 분류 고치기 (woowayouths 섹션 "저장" = 행저장) */
  buttonKinds?: Record<string, ButtonKind>;
  /** 채우면 안 되는 칸 (ninehire 자소서 1·2가 "내용 #1/#2"로 잡히는 것) */
  manual?: { label: string; section?: string; reason: ManualReason }[];
  updatedAt?: string;
}

/** 여러 회사가 같이 쓰는 채용 솔루션 */
const ATS: [RegExp, string][] = [
  [/(^|\.)careerlink\.kr$/i, 'careerlink'],
  [/(^|\.)ninehire\.(site|com)$/i, 'ninehire'],
  [/(^|\.)recruiter\.co\.kr$/i, 'recruiter'],
  [/(^|\.)greetinghr\.com$/i, 'greeting'],
  [/(^|\.)career\.woowayouths\.com$/i, 'woowayouths'],
];

export function siteKeys(url: string): { ats?: string; host: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { host: '' };
  }
  // 로컬 테스트 페이지는 폴더/파일 이름으로 구분한다
  const host = u.protocol === 'file:' ? `file-${u.pathname.split('/').slice(-2).join('-').replace(/[^\w.-]/g, '_')}` : u.host.toLowerCase();
  const ats = ATS.find(([re]) => re.test(u.host))?.[1];
  return { ats, host };
}

function mergeSection(a: SectionAdapter = {}, b: SectionAdapter = {}): SectionAdapter {
  const out: SectionAdapter = { ...a, ...b };
  if (a.labels || b.labels) out.labels = { ...a.labels, ...b.labels };
  if (a.resets || b.resets) out.resets = { ...a.resets, ...b.resets };
  if (a.external || b.external) out.external = { ...a.external, ...b.external };
  for (const k of ['fields', 'order', 'requiredFiles'] as const) {
    if (a[k] || b[k]) out[k] = [...new Set([...(a[k] ?? []), ...(b[k] ?? [])])];
  }
  return out;
}

export function mergeAdapters(...list: (SiteAdapter | undefined)[]): SiteAdapter | undefined {
  const xs = list.filter((x): x is SiteAdapter => !!x);
  if (!xs.length) return undefined;
  const out: SiteAdapter = { site: xs[xs.length - 1].site };
  for (const x of xs) {
    if (x.ats) out.ats = x.ats;
    if (x.notes) out.notes = [...new Set([...(out.notes ?? []), ...x.notes])];
    if (x.values) out.values = { ...out.values, ...x.values };
    if (x.buttonKinds) out.buttonKinds = { ...out.buttonKinds, ...x.buttonKinds };
    if (x.manual) out.manual = [...(out.manual ?? []), ...x.manual];
    if (x.sections) {
      out.sections ??= {};
      for (const [k, v] of Object.entries(x.sections)) out.sections[k] = mergeSection(out.sections[k], v);
    }
    if (x.updatedAt) out.updatedAt = x.updatedAt;
  }
  return out;
}

export class AdapterStore {
  private readonly seeds = new Map<string, SiteAdapter>();
  private readonly learned = new Map<string, SiteAdapter>();
  private readonly dirty = new Set<string>();

  constructor(
    private readonly dir: string,
    seedDir?: string,
  ) {
    if (seedDir && existsSync(seedDir)) {
      for (const f of readdirSync(seedDir).filter((x) => x.endsWith('.json'))) {
        const a = JSON.parse(readFileSync(path.join(seedDir, f), 'utf8')) as SiteAdapter;
        this.seeds.set(a.site, a);
      }
    }
  }

  private file(key: string): string {
    return path.join(this.dir, `${key.replace(/[^\w.-]/g, '_')}.json`);
  }

  private load(key: string): SiteAdapter | undefined {
    if (this.learned.has(key)) return this.learned.get(key);
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    try {
      const a = JSON.parse(readFileSync(f, 'utf8')) as SiteAdapter;
      this.learned.set(key, a);
      return a;
    } catch {
      return undefined;
    }
  }

  /** 이 주소에 쓸 어댑터: 기본(ATS) → 배운 것(ATS) → 기본(사이트) → 배운 것(사이트) 순서로 겹친다 */
  lookup(url: string): SiteAdapter | undefined {
    const { ats, host } = siteKeys(url);
    if (!host) return undefined;
    return mergeAdapters(ats ? this.seeds.get(ats) : undefined, ats ? this.load(ats) : undefined, this.seeds.get(host), this.load(host));
  }

  /** 배운 것은 ATS가 있으면 ATS에 쌓는다 (메리츠에서 배운 걸 다른 careerlink 회사도 쓴다) */
  private target(url: string): SiteAdapter | undefined {
    const { ats, host } = siteKeys(url);
    const key = ats ?? host;
    if (!key) return undefined;
    let a = this.load(key);
    if (!a) {
      a = { site: key, ...(ats ? { ats } : {}) };
      this.learned.set(key, a);
    }
    this.dirty.add(key);
    return a;
  }

  private section(url: string, title: string): SectionAdapter | undefined {
    const a = this.target(url);
    if (!a) return undefined;
    a.sections ??= {};
    return (a.sections[title] ??= {});
  }

  learnLabel(url: string, section: string | undefined, from: string, to: string): void {
    if (!section) return;
    const s = this.section(url, section);
    if (s) s.labels = { ...s.labels, [from]: to };
  }

  learnFields(url: string, section: string, labels: string[]): void {
    const s = this.section(url, section);
    if (s) s.fields = [...new Set(labels.filter(Boolean))].slice(0, 40);
  }

  learnMaxRows(url: string, section: string, n: number): void {
    const s = this.section(url, section);
    if (s) s.maxRows = n;
  }

  learnReset(url: string, section: string, by: string, cleared: string[]): void {
    const s = this.section(url, section);
    if (!s) return;
    s.resets = { ...s.resets, [by]: [...new Set([...(s.resets?.[by] ?? []), ...cleared])] };
    s.order = [...new Set([...(s.order ?? []), by])];
  }

  learnExternal(url: string, section: string, item: string, via: string): void {
    const s = this.section(url, section);
    if (s) s.external = { ...s.external, [item]: via };
  }

  /** 바뀐 어댑터를 파일로 저장 */
  flush(): void {
    if (!this.dirty.size) return;
    mkdirSync(this.dir, { recursive: true });
    for (const key of this.dirty) {
      const a = this.learned.get(key);
      if (!a) continue;
      a.updatedAt = new Date().toISOString();
      const f = this.file(key);
      writeFileSync(`${f}.tmp`, `${JSON.stringify(a, null, 2)}\n`, 'utf8');
      renameSync(`${f}.tmp`, f);
    }
    this.dirty.clear();
  }
}
