// 종단 간 확인: 실제 Claude(claude -p)가 MCP 툴만 가지고 테스트 지원서를 가짜 프로필(profile.json)로 채우게 한 뒤,
// 남아 있는 브라우저에 붙어 폼 상태를 프로필과 대조한다. 칸 매핑을 LLM이 제대로 하는지까지 보는 검사다.
// 지금 로그인된 Claude 계정으로 돈다: 구독이면 사용 한도에서 차감, API 키면 토큰 과금
// (API 요금 환산 시나리오당 약 $0.15~0.25) → npm test에는 넣지 않았다.
// 사용법: npm run e2e                 (전부, 가짜 프로필)
//        npm run e2e -- limits         (하나만)
//        E2E_PROFILE=data/profile.json npm run e2e -- limits   (내 프로필로: limits·careerlink 시나리오는 판정이 프로필 기준이라 그대로 쓸 수 있다)
//        E2E_MODEL=claude-sonnet-5-5 E2E_EFFORT=medium npm run e2e -- careerlink   (모델·effort를 바꿔 속도 비교)
//        E2E_CLAUDE=<claude.exe 경로>   (PATH의 claude가 오래돼 새 모델을 못 쓸 때, 데스크톱 앱에 든 최신 claude.exe)
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 9444; // 실사용 브라우저(9333)와 겹치지 않게
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const fixture = (name) => pathToFileURL(path.join(ROOT, 'test', 'fixtures', name)).href;

const PROFILE = path.resolve(ROOT, process.env.E2E_PROFILE ?? 'test/e2e/profile.json');

const eq = (want) => (v) => v === want;
const oneOf = (...want) => (v) => want.includes(v);
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '');
const dotted = (iso) => String(iso ?? '').replaceAll('-', '.');
const low = (v) => String(v ?? '').toLowerCase();

const SCENARIOS = {
  mui: {
    page: 'mui/index.html',
    prompt: (url) => `${url} 지원서를 내 프로필로 채워줘.`,
    async read(page) {
      return page.evaluate(() => window.__fixtureState);
    },
    checks: (s) => [
      ['성명', s.form.name, eq('김지원')],
      ['영문 성', s.form.nameEnLast, eq('Kim')],
      ['영문 이름', s.form.nameEnFirst, eq('Jiwon')],
      ['생년월일', s.form.birth, eq('2000-07-21')],
      ['성별', s.form.gender, eq('F')],
      ['휴대폰', s.form.phone, eq('010-9876-5432')],
      ['이메일', s.form.email, eq('jiwon.kim@naver.com')],
      ['병역구분', s.form.military, eq('04')],
      ['학교명', s.edu[0].school, eq('한국대학교')],
      ['전공', s.edu[0].major, eq('경영학')],
      ['졸업구분', s.edu[0].gradType, eq('졸업예정')],
      ['졸업(예정)일 (선택 후 나타나는 칸)', s.edu[0].end, eq('2027-02')],
      ['학점', s.edu[0].gpa, eq('4.1')],
      ['경력 있음 (체크 안 해야)', s.form.hasCareer, eq(false)],
      ['자소서 (비어 있어야)', s.form.essay, eq('')],
      ['동의 (체크 안 해야)', s.form.agree, eq(false)],
      ['최종제출 (안 해야)', s.submitted, eq(false)],
      ['임시저장 (안 눌러야)', s.saved, eq(0)],
    ],
  },
  legacy: {
    page: 'legacy.html',
    prompt: (url) =>
      `${url} 지원서를 내 프로필로 채워줘. 사진, 자소서, 동의, 주소 검색은 내가 나중에 할 테니 신경 쓰지 말고 다음 단계로 넘어가서 계속 채워줘.`,
    async read(page) {
      const s = await page.evaluate(() => {
        const v = (n) => document.querySelector(`[name="${n}"]`)?.value;
        const c = (n) => document.querySelector(`[name="${n}"]`)?.checked;
        return {
          nameKo: v('nameKo'),
          nameEn: v('nameEn'),
          birth: v('birth'),
          gender: document.querySelector('[name="gender"]:checked')?.value,
          tel: [v('tel1'), v('tel2'), v('tel3')].join('-'),
          email: `${v('emailId')}@${v('emailDomain')}`,
          zip: v('zip'),
          addr2: v('addr2'),
          rrn: v('rrn'),
          military: v('military'),
          milStart: v('milStart'),
          school: v('school'),
          major: v('major'),
          eduStart: v('eduStart'),
          grad: v('grad'),
          gpa: `${v('gpa')}/${v('gpaMax')}`,
          cert: v('cert'),
          certDate: v('certDate'),
          newsletter: c('newsletter'),
          agree: c('agree'),
          essay: v('essay1'),
          step2: !document.getElementById('step2').classList.contains('hide'),
          hobby: v('hobby'),
          submitted: window.submitted,
          stateName: window.state.nameKo,
        };
      });
      const frame = page.frames().find((f) => f.url().includes('legacy-frame'));
      s.referrer = frame ? await frame.evaluate(() => document.querySelector('[name="referrer"]').value) : undefined;
      return s;
    },
    checks: (s) => [
      ['성명', s.nameKo, eq('김지원')],
      ['성명이 페이지 상태(이벤트)에도 반영', s.stateName, eq('김지원')],
      ['영문성명', String(s.nameEn).toLowerCase(), oneOf('kim jiwon', 'jiwon kim')],
      ['생년월일 (YYYY.MM.DD로 변환)', s.birth, eq('2000.07.21')],
      ['성별', s.gender, eq('F')],
      ['휴대폰 3칸', s.tel, eq('010-9876-5432')],
      ['이메일 2칸', s.email, eq('jiwon.kim@naver.com')],
      ['상세주소', s.addr2, eq('101동 1203호')],
      ['병역구분', s.military, eq('해당없음')],
      ['입대일 (해당없음이라 비워야)', s.milStart, eq('')],
      ['학교명', s.school, eq('한국대학교')],
      ['전공', s.major, eq('경영학')],
      ['입학년월', s.eduStart, eq('2021-03')],
      ['졸업구분', s.grad, eq('졸업예정')],
      ['학점/만점', s.gpa, eq('4.1/4.5')],
      ['자격증명', s.cert, eq('정보처리기사')],
      ['취득일', s.certDate, eq('2025.06.13')],
      ['메일 수신 (프로필에 없음 → 체크 안 해야)', s.newsletter, eq(false)],
      ['우편번호 (검색 팝업 칸 → 손대지 않아야)', s.zip, eq('')],
      ['주민번호 (비어 있어야)', s.rrn, eq('')],
      ['자소서 (비어 있어야)', s.essay, eq('')],
      ['동의 (체크 안 해야)', s.agree, eq(false)],
      ['다음 단계로 이동', s.step2, eq(true)],
      ['취미 (프로필에 없음 → 지어내지 않아야)', s.hobby, eq('')],
      ['추천인 (프로필에 없음 → 지어내지 않아야)', s.referrer, eq('')],
      ['최종 제출 (안 해야)', s.submitted, eq(undefined)],
    ],
  },
  // 개수·글자 수·바이트 제한. 판정은 기대값을 박지 않고 프로필에서 계산한다 (어떤 프로필로도 돌릴 수 있게)
  limits: {
    page: 'limits.html',
    prompt: (url) => `${url} 지원서를 내 프로필로 채워줘.`,
    async read(page) {
      return page.evaluate(() => {
        const one = (n) => document.querySelector(`[name="${n}"]`)?.value ?? '';
        const all = (n) => [...document.querySelectorAll(`[name="${n}"]`)].map((e) => e.value);
        const rows = (sel, names) =>
          [...document.querySelectorAll(`${sel} tbody tr`)].map((tr) =>
            Object.fromEntries(names.map((n) => [n, tr.querySelector(`[name="${n}"]`)?.value ?? ''])),
          );
        return {
          name: one('name'),
          enLast: one('enLast'),
          enFirst: one('enFirst'),
          birth: one('birth'),
          phone: one('phone'),
          mil: ['milType', 'milBranch', 'milRank', 'milSpecialty', 'milStart', 'milEnd'].map(one),
          milReason: one('milReason'),
          skills: all('skill').map((name, i) => ({ name, level: all('skillLevel')[i], years: all('skillYears')[i] })),
          awards: rows('#awards', ['awardName', 'awardOrg', 'awardDate', 'awardDesc']),
          act: { org: one('actOrg'), name: one('actName'), desc: one('actDesc') },
          certs: rows('#certs', ['certName', 'certOrg', 'certDate', 'certNo']),
          lang: { test: one('langTest'), score: one('langScore'), date: one('langDate'), no: one('langNo') },
          proj: one('projSummary'),
          projBytes: Number(document.getElementById('projBytes').textContent),
          essay: one('essay'),
          submitted: window.submitted,
          saved: window.saved,
        };
      });
    },
    checks: (s, p) => {
      const bi = p.기본정보 ?? {};
      const mil = p.병역 ?? {};
      const skills = p.스킬 ?? [];
      const awards = p.수상 ?? [];
      const certs = p.자격증 ?? [];
      const skillOf = (n) => skills.find((x) => low(x.이름) === low(n));
      const awardOf = (n) => awards.find((x) => x.수상명 === n);
      const certOf = (n) => certs.find((x) => low(x.자격증명).includes(low(n)) || low(n).includes(low(x.자격증명)));
      const filledSkills = s.skills.filter((x) => x.name);
      const filledAwards = s.awards.filter((x) => x.awardName);
      const filledCerts = s.certs.filter((x) => x.certName);
      const served = mil.구분 === '군필';
      return [
        ['성명', s.name, eq(bi.이름)],
        ['영문 성 (대문자로 변환)', s.enLast, eq(String(bi.영문이름?.성 ?? '').toUpperCase())],
        ['영문 이름 (대문자로 변환)', s.enFirst, eq(String(bi.영문이름?.이름 ?? '').toUpperCase())],
        ['생년월일 (YYYYMMDD로 변환)', s.birth, eq(digitsOf(bi.생년월일))],
        ['휴대폰 (숫자만, 프로필에 없으면 비움)', s.phone, eq(digitsOf(bi.휴대폰))],
        served
          ? ['병역 구분·군별·계급·병과·기간', s.mil.join('|'), eq([mil.구분, mil.군별, mil.계급, mil.병과, dotted(mil.입대일), dotted(mil.전역일)].join('|'))]
          : ['병역 (미복무 → 비대상 계열, 나머지 비움)', s.mil.join('|'), (v) => /^(비대상|면제|미필)\|\|\|\|\|$/.test(v)],
        ['전역사유 (프로필에 없으면 지어내지 않음)', s.milReason, eq(mil.전역사유 ?? '')],
        [`스킬 칸 수 = min(5, 프로필 ${skills.length}개)`, filledSkills.length, eq(Math.min(5, skills.length))],
        ['스킬은 프로필에 있는 것만, 수준·기간도 프로필대로', filledSkills.map((x) => `${x.name}/${x.level}/${x.years}`).join(', '), () =>
          filledSkills.every((x) => skillOf(x.name) && skillOf(x.name).수준 === x.level && digitsOf(skillOf(x.name).경력) === digitsOf(x.years))],
        [`수상 행 수 = min(3, 프로필 ${awards.length}개)`, filledAwards.length, eq(Math.min(3, awards.length))],
        ['수상명·수상일은 프로필 그대로 (YYYY.MM.DD)', filledAwards.map((x) => `${x.awardName} ${x.awardDate}`).join(' / '), () =>
          filledAwards.every((x) => awardOf(x.awardName) && dotted(awardOf(x.awardName).수상일) === x.awardDate)],
        ['수상 내용 1~100자', filledAwards.map((x) => x.awardDesc.length).join(', '), () => filledAwards.every((x) => x.awardDesc.length > 0 && x.awardDesc.length <= 100)],
        ['활동내용 1~300자', s.act.desc.length, (v) => ((p['활동·교육'] ?? []).length ? v > 0 && v <= 300 : v === 0)],
        [`자격증 행 수 = min(2, 프로필 ${certs.length}개)`, filledCerts.length, eq(Math.min(2, certs.length))],
        ['자격번호는 프로필 그대로', filledCerts.map((x) => `${x.certName}:${x.certNo}`).join(', '), () =>
          filledCerts.every((x) => certOf(x.certName) && (certOf(x.certName).자격번호 ?? '') === x.certNo)],
        ['어학 1줄 (시험·점수·수험번호)', [s.lang.test, s.lang.score, s.lang.no].join(' / '), () =>
          (p.어학 ?? []).length ? !!(s.lang.test && s.lang.score && s.lang.no) : !s.lang.test],
        ['한 줄 요약 100byte 이내 (사이트 카운터)', s.projBytes, (v) => v <= 100],
        ['자소서 (비어 있어야)', s.essay, eq('')],
        ['제출 (안 해야)', s.submitted, eq(undefined)],
        ['임시저장 (안 눌러야)', s.saved, eq(0)],
      ];
    },
    dump: (s) =>
      [
        `스킬: ${s.skills.filter((x) => x.name).map((x) => `${x.name}(${x.level}, ${x.years}년)`).join(', ')}`,
        ...s.awards.filter((x) => x.awardName).map((x) => `수상: ${x.awardName} | ${x.awardOrg} | ${x.awardDate}\n      내용(${x.awardDesc.length}자): ${x.awardDesc}`),
        `활동: ${s.act.org} / ${s.act.name}\n      내용(${s.act.desc.length}자): ${s.act.desc}`,
        ...s.certs.filter((x) => x.certName).map((x) => `자격증: ${x.certName} | ${x.certOrg} | ${x.certDate} | ${x.certNo}`),
        `어학: ${s.lang.test} ${s.lang.score} | ${s.lang.date} | ${s.lang.no}`,
        `한 줄 요약(${s.projBytes}byte): ${s.proj}`,
        `전역사유: "${s.milReason}" · 휴대폰: "${s.phone}"`,
      ].join('\n'),
  },
  // careerlink 실제 구조 (편집 팝업 + 저장하기, DB 자동완성, 토글, 최대 개수). 내 프로필로 돌리는 용도
  careerlink: {
    page: 'careerlink/index.html',
    prompt: (url) => `${url} 지원서를 내 프로필로 채워줘. IT전산 직무로 지원해.`,
    async read(page) {
      return page.evaluate(() => window.__fixtureState);
    },
    checks: (s, p) => {
      const bi = p.기본정보 ?? {};
      const univ = p.학력?.대학교?.[0] ?? {};
      const hs = p.학력?.고등학교 ?? {};
      const u = s.rows.UNIV[0] ?? {};
      const h = s.rows.HISC[0] ?? {};
      const certs = p.자격증 ?? [];
      const exp = s.rows.EXPC;
      return [
        ['지원 직무', s.apply.job, eq('IT전산')],
        ['휴대폰 (빈 칸 → 프로필 값)', s.apply.phone.replace(/\D/g, ''), eq(digitsOf(bi.휴대폰))],
        ['미리 채워진 영문 이름은 덮어쓰지 않음', s.apply.enName, eq('HONG GIL DONG')],
        ['가산점 (비대상 → 체크 안 함)', `${s.apply.disability}/${s.apply.veteran}`, eq('false/false')],
        ['고등학교 1행', `${h.school}|${h.grad}|${h.end}`, eq(`${hs.학교명}|${hs.졸업구분}|${dotted(hs.졸업일)}`)],
        ['대학교 1행 (세종캠퍼스 후보·분교)', `${u.school}|${u.campus}|${u.region}`, eq('한국대학교(세종)|분교|세종')],
        ['대학교 전공·학점·만점', `${u.major}|${u.gpa}|${u.gpaMax}`, eq(`${univ.주전공}|${univ.학점}|${univ.만점}`)],
        ['대학교 졸업구분·기간', `${u.grad}|${u.start}|${u.end}`, eq(`${univ.졸업구분}|${dotted(univ.입학일)}|${dotted(univ.졸업일)}`)],
        ['대학교 주야·편입·부전공', `${u.dayNight}|${u.entry}|${u.minorType}`, eq('주간|신규입학|해당없음')],
        [`자격 ${certs.length}행`, s.rows.LCNS.map((r) => `${r.name}:${r.no}`).join(', '), () => s.rows.LCNS.length === certs.length && s.rows.LCNS.every((r) => r.no && certs.some((c) => c.자격번호 === r.no))],
        ['경험 1~5행 (최대 5개)', exp.length, (v) => v >= 1 && v <= 5],
        ['경험단체명 25자 이내', exp.map((r) => r.org.length).join(', '), () => exp.every((r) => r.org.length > 0 && r.org.length <= 25)],
        ['저장 안 하고 닫힌 팝업 0번', s.discarded, eq(0)],
        ['편집 팝업이 열린 채 끝나지 않음', s.editing, eq(null)],
        ['최종제출 (안 해야)', s.submitted, eq(false)],
        ['임시저장 (안 눌러야)', s.saved, eq(0)],
      ];
    },
    dump: (s) =>
      [
        `지원: ${s.apply.job} · 휴대폰 ${s.apply.phone} · 영문 ${s.apply.enName}`,
        ...s.rows.HISC.map((r) => `고교: ${JSON.stringify(r)}`),
        ...s.rows.UNIV.map((r) => `대학: ${JSON.stringify(r)}`),
        ...s.rows.LCNS.map((r) => `자격: ${JSON.stringify(r)}`),
        ...s.rows.EXPC.map((r) => `경험: ${r.type} | ${r.org} (${r.org.length}자) | ${r.start}~${r.end} | ${r.desc.slice(0, 80)}`),
      ].join(' \n'),
  },
  // kt.recruiter.co.kr(ats-) 구조: aria 없는 버튼 드롭다운, 실제 키 입력에만 반응하는 학교 검색, 색으로만 표시하는 버튼 묶음,
  // 팝업 없이 페이지 안에 펼치는 "추가하기"(전공). 판정은 프로필 기준이라 내 프로필로도 돌릴 수 있다
  ats: {
    page: 'ats.html',
    prompt: (url) =>
      `${url} 지원서를 내 프로필로 채워줘. 지원분야는 IT, 희망직무는 데이터분석, 지원경로는 채용 홈페이지로 해. 주소·사진·자소서는 내가 나중에 할 테니 신경 쓰지 마.`,
    async read(page) {
      return page.evaluate(() => window.__fixtureState);
    },
    checks: (s, p) => {
      const bi = p.기본정보 ?? {};
      const u = p.학력?.대학교?.[0] ?? {};
      const served = p.병역?.구분 === '군필';
      const ym = (v) => digitsOf(v).slice(0, 6);
      return [
        ['이름', s.f.name, eq(bi.이름)],
        ['생년월일', digitsOf(s.f.birth), eq(digitsOf(bi.생년월일))],
        ['성별', s.f.gender, eq(bi.성별 === '여' ? 'F' : 'M')],
        ['핸드폰', digitsOf(s.f.phone), eq(digitsOf(bi.휴대폰))],
        ['이메일', s.f.email, eq(bi.이메일)],
        ['지원분야/희망직무 (버튼 드롭다운, 앞 칸이 풀어 주는 칸)', `${s.f.field}/${s.f.job}`, eq('IT/데이터분석')],
        ['지원경로', s.f.route, eq('채용 홈페이지')],
        ['국적 (목록 안에서 검색)', s.f.nationality, eq(bi.국적 ?? '대한민국')],
        ['병역 (버튼 묶음)', s.f.military, (v) => (served ? v === '군필' : ['비대상', '면제', '미필'].includes(v))],
        ['장애/보훈', `${s.f.disability}/${s.f.veteran}`, eq(`${p.장애여부 ?? '비대상'}/${p.보훈대상 ?? '비대상'}`)],
        ['학위', s.f.degree, eq(u.학위)],
        ['학교명 (키 입력 검색 → 후보 클릭)', s.f.school, eq(u.학교명)],
        ['본교/분교 (학교를 골라야 풀림)', s.f.campus, eq(u.캠퍼스)],
        ['주간/야간', s.f.dayNight, eq(u.주야)],
        ['입학·졸업 년월', `${ym(s.f.eduStart)}~${ym(s.f.eduEnd)}`, eq(`${ym(u.입학일)}~${ym(u.졸업일)}`)],
        ['졸업구분', s.f.grad, eq(u.졸업구분)],
        ['학점/만점', `${s.f.gpa}/${s.f.gpaMax}`, eq(`${u.학점}/${u.만점}`)],
        ['전공 (추가하기 → 페이지 안에 펼친 줄)', s.majors.map((m) => m.name).join(','), (v) => v.split(',').includes(u.주전공)],
        ['새 학교 "등록하기" (안 눌러야)', s.registered.length, eq(0)],
        ['임시저장 (안 눌러야)', s.saved, eq(0)],
        ['제출 (안 해야)', s.submitted, eq(false)],
      ];
    },
    dump: (s) => JSON.stringify({ ...s.f, majors: s.majors, registered: s.registered }),
  },
};

async function closeBrowser() {
  try {
    const b = await chromium.connectOverCDP(ENDPOINT, { timeout: 2000 });
    const s = await b.newBrowserCDPSession();
    await s.send('Browser.close').catch(() => {});
  } catch {
    // 떠 있는 브라우저 없음
  }
}

function runClaude(prompt, cwd, mcpConfig) {
  const args = [
    '-p',
    prompt,
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config', // 다른 MCP(메일 등) 연결 안 함
    '--tools',
    '', // 기본 툴(파일 읽기 등) 끔: 테스트 페이지 소스를 보고 답을 맞히지 못하게
    '--allowedTools',
    'mcp__careerlog-fill',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--max-budget-usd',
    '3',
    ...(process.env.E2E_MODEL ? ['--model', process.env.E2E_MODEL] : []),
    ...(process.env.E2E_EFFORT ? ['--effort', process.env.E2E_EFFORT] : []),
  ];
  const r = spawnSync(process.env.E2E_CLAUDE ?? 'claude', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 9 * 60 * 1000 });
  if (r.error) throw r.error;
  return r.stdout
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l));
}

async function runScenario(name, sc) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `careerlog-e2e-${name}-`));
  copyFileSync(PROFILE, path.join(dir, 'profile.json')); // 복사본을 쓴다: save_profile이 원본을 바꾸지 않게
  const profile = JSON.parse(readFileSync(PROFILE, 'utf8'));
  const mcpConfig = path.join(dir, 'mcp.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        'careerlog-fill': {
          type: 'stdio',
          command: process.execPath,
          args: [path.join(ROOT, 'dist', 'index.js')],
          env: {
            CAREERLOG_HEADLESS: '1',
            CAREERLOG_CDP_PORT: String(PORT),
            CAREERLOG_BROWSER_PROFILE: path.join(dir, 'browser'),
            CAREERLOG_PROFILE: path.join(dir, 'profile.json'),
            CAREERLOG_DATA_DIR: path.join(dir, 'data'),
          },
        },
      },
    }),
  );

  await closeBrowser();
  console.log(`\n=== ${name}: claude -p 실행 중…`);
  const events = runClaude(sc.prompt(fixture(sc.page)), dir, mcpConfig);
  const result = events.find((e) => e.type === 'result');
  const calls = events
    .filter((e) => e.type === 'assistant')
    .flatMap((e) => e.message.content.filter((c) => c.type === 'tool_use'))
    .map((c) => c.name.replace('mcp__careerlog-fill__', ''));

  const browser = await chromium.connectOverCDP(ENDPOINT);
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes(sc.page));
  if (!page) throw new Error(`${name}: 브라우저에서 테스트 페이지를 찾지 못함 (Claude가 페이지를 열지 않았을 수 있음)`);
  const state = await sc.read(page);
  const checks = sc.checks(state, profile);
  await closeBrowser();
  // 임시 브라우저 프로필 정리 (브라우저가 파일을 놓을 때까지 잠깐 재시도)
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

  let pass = 0;
  for (const [label, value, ok] of checks) {
    const good = ok(value);
    if (good) pass++;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(value)}`);
  }
  if (sc.dump) console.log(`--- 실제로 들어간 값 ---\n${sc.dump(state)}`);
  console.log(`툴 호출 ${calls.length}번: ${calls.join(' → ')}`);
  if (result) {
    // total_cost_usd는 API 요금 기준 환산값이다. 구독 로그인이면 실제로 청구되지 않는다.
    console.log(
      `턴 ${result.num_turns} · ${Math.round(result.duration_ms / 1000)}초 · API 환산 $${(result.total_cost_usd ?? 0).toFixed(3)} · ${result.subtype}`,
    );
    console.log(`--- Claude 요약 ---\n${String(result.result ?? '').slice(0, 1500)}`);
  }
  console.log(`${name}: ${pass}/${checks.length} 통과`);
  return pass === checks.length;
}

const only = process.argv[2];
let allOk = true;
for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only && only !== name) continue;
  allOk = (await runScenario(name, sc)) && allOk;
}
process.exit(allOk ? 0 : 1);
