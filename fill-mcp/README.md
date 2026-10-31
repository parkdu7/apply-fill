# careerlog-fill-mcp

지원서의 기본정보(인적사항, 학력, 병역, 자격증 등)를 내 프로필로 채워 주는 MCP 서버예요. CareerLog Phase 1("채우기 에이전트")의 프로토타입입니다.

- **판단은 LLM, 실행은 코드**: 어떤 칸에 무슨 값을 넣을지는 Claude가 정하고, 입력·검증·안전장치는 코드가 맡아요.
- **굵은 툴**: 칸 추출 한 번, 일괄 입력 한 번으로 왕복을 줄여요. 입력하고 나면 값을 다시 읽어서 칸마다 검증 결과를 돌려줘요.
- **제출은 사람이**: 제출·최종제출·지원하기·미리보기·삭제 버튼은 코드에서 막혀 있어요.
- **두 가지 실행 방식**: Claude Code/Desktop에서 쓰는 Playwright 모드(전용 크롬 창), 그리고 크롬 확장(`../extension`)의 사이드패널에서 원클릭으로 쓰는 확장 모드. 둘 다 같은 `src/dom` 코드로 칸을 읽고 넣어요.

## 처음 한 번

```bash
cd fill-mcp
npm install
npm run build
```

1. **프로필 채우기**: `data/profile.json`에 내 정보를 적어요. 파일이 없으면 Claude가 처음 `get_profile`을 부를 때 `profile.example.json`을 복사해서 만들어 줘요.
   - 빈 칸(`""`)은 없는 정보로 보고, 날짜는 `YYYY-MM-DD`로 적어요.
   - 수상에는 긴 `상세`와 짧은 `요약`을 같이 두면, 글자 수 제한이 있는 칸에 `요약`을 써요.
   - `입력규칙`에 개인 규칙(영문 이름 형식, 개수 제한 시 고르는 기준)을 적어 두면 Claude가 먼저 따라요.
   - 비워 둔 칸은 지원서를 채우다가 Claude가 물어보고, 동의하면 저장해 줘요.
2. **Claude Code에서 서버 승인**: 저장소 루트의 `.mcp.json`에 `careerlog-fill`이 등록돼 있어요. `E:\code_2026\career_log`에서 새 세션을 열고, 처음 한 번 서버 사용을 승인해 주세요.

## 쓰는 법

1. 작업용 브라우저를 열어요. 평소 쓰는 크롬과 분리된 전용 프로필의 크롬 창이에요(크롬이 없는 PC면 엣지).
   ```bash
   npm run browser -- https://prsb.careerlink.kr/jobs/RC20261006036644
   ```
   Claude에게 "브라우저 열어줘"라고 해도 돼요(`browser_open`).
2. 그 창에서 **직접 로그인**하고 지원서 작성 화면까지 들어가요. 로그인 정보는 도구가 다루지 않아요.
3. Claude Code에서 `/mcp__careerlog-fill__fill`을 실행하거나 "지원서 채워줘"라고 말해요.
   - 지원서마다 **새 세션**을 쓰고, 모델은 **Sonnet 5.5 · effort medium**을 권해요. Opus high와 걸리는 시간은 비슷한데(90초 안팎) 사용량은 3분의 1이에요.
4. 초록(확실)·노랑(추정)·빨강(불일치) 표시를 확인하고, 자기소개서·동의·파일 첨부를 직접 한 뒤 **제출도 직접** 해요.

브라우저는 MCP 서버와 따로 돌아가서, Claude 세션이 바뀌어도 로그인 상태가 유지돼요(디버깅 포트 `127.0.0.1:9333`).

### Claude Desktop에서 쓰려면

`%APPDATA%\Claude\claude_desktop_config.json`에 아래를 추가해요.

```json
{
  "mcpServers": {
    "careerlog-fill": { "command": "node", "args": ["E:/code_2026/career_log/fill-mcp/dist/index.js"] }
  }
}
```

## 툴

| 툴 | 하는 일 |
|---|---|
| `browser_open` | 작업 브라우저를 열거나 연결하고, url이 있으면 이동 |
| `browser_tabs` | 탭 목록과 선택. 지원서가 팝업 창으로 열리는 사이트용 |
| `get_profile` / `save_profile` | 프로필 보기(빈 항목 목록 포함) / 사용자가 동의한 값만 저장 |
| `extract_fields` | 칸과 버튼을 섹션별로 압축해서 추출. 라벨, 종류, 선택지, placeholder, 현재 값, 분할 칸(`칸 2/3`), 반복 행(`#2`). aria 없는 버튼형·div형 드롭다운(antd `ant-dropdown-trigger`·Select 포함)·버튼 묶음(군필/미필)도 칸으로 읽는다. div로 그린 주소 칸은 "직접 입력: 주소 검색 팝업"으로 표시. `changed_only`면 바뀐 것만 |
| `fill_fields` | 일괄 입력 → 다시 읽어서 검증 → 불일치면 키보드로 자동 재시도. 자동완성은 `query`(검색어)·`direct`(직접입력). `then_click`으로 다 맞으면 저장 버튼까지 |
| `add_rows` | 반복 섹션(학력·자격·경험 등)에 행 여러 개를 한 번에: 추가 → 편집 팝업 → 라벨로 칸 찾기 → 입력 → 저장하기 → 닫힘 확인. 팝업 없이 페이지 안에 줄이 펼쳐지는 사이트는 새로 생긴 칸을 그 행으로 채운다 |
| `click_button` | 검색·수정 같은 버튼(`times`로 여러 번). 누른 뒤 새로 생긴 칸, 값이 바뀐 칸, 열린 팝업을 돌려줌. 비활성 버튼은 누르지 않고 알려 줌 |
| `next_step` | 다단계 지원서의 "다음" 버튼 |
| `wait_for_user` | 사용자가 직접 할 일(성적 조회, 본인인증 등)을 안내한 뒤 끝날 때까지 기다림. 팝업 닫힘·주소 변경·저장된 행·첨부 수·지켜볼 칸 값이 바뀌면 바로 돌아옴 |
| `attach_files` | 파일 보관함의 파일을 업로드 칸에 첨부. 칸의 형식(accept)·안내문의 크기("최대 10MB")·발급일("3개월 이내")을 확인하고, 이미 파일이 있으면 덮어쓰지 않음. 넣은 뒤 페이지에 보이는 이름까지 확인. `add_rows`는 팝업의 필수 업로드 칸에 종류가 하나만 맞는 파일을 자동으로 붙임 |
| `search_address` | 다음(카카오) 우편번호 검색(레이어 iframe·새 창)에서 검색 → 결과가 하나면(또는 `pick`과 맞는 줄이 하나면) 고름 → 사이트가 채운 우편번호·주소 칸을 돌려줌 |
| `ask_user` | 프로필에 없는 값을 한 번에 묻기. 확장에서는 사이드패널에 질문을 올리고 턴을 끝냄(답은 `--resume`으로 이어짐). Playwright 모드는 대화로 물어보라는 안내 |
| `login` | 확장 전용. 계정 보관함에 이 사이트(정확히 같은 origin) 계정이 있으면 로그인. 비밀번호는 확장 밖으로 나오지 않고 결과는 상태만. CAPTCHA·2단계 인증·본인인증이면 멈춤, 실패해도 다시 시도하지 않음 |
| `snapshot_page` | 현재 페이지 HTML을 `data/snapshots/`에 저장(디버깅·오프라인 테스트용) |

## 안전장치 (코드에서 강제)

- 제출 계열 버튼은 누르기 직전에 글자를 다시 읽고, 페이지 안과 Node 쪽에서 한 번씩 확인해요. 확인창도 제출·접수 문구면 취소해요.
- 이미 값이 있는 칸은 덮어쓰지 않아요. 사용자가 원할 때만 `overwrite: true`로 덮어써요.
- 자기소개서, 동의·서약, 비밀번호, 민감정보(주민번호·계좌·여권번호) 칸에는 입력을 거부해요. 주민번호·카드번호 모양의 값은 입력도 저장도 하지 않아요.
- 파일은 보관함에 넣어 둔 것만 첨부해요. 파일 내용은 LLM에게 가지 않고 이름·종류·크기·발급일만 보여요.
- 사람이 직접 누른 버튼에서 뜬 확인창은 건드리지 않아요. 에이전트가 동작하는 동안 뜬 창만 대신 처리해요.
- Escape 키는 보내지 않아요(편집 팝업이 닫혀 입력한 행이 사라져요).
- 로그인 비밀번호는 확장의 계정 보관함(AES-GCM 암호화)에서 그 프레임으로 바로 가요. MCP 서버·도구 결과·로그 어디에도 들어가지 않아요.

## 구조

```
src/
  dom/          페이지 안 코드 (Playwright는 evaluate로 주입, 확장은 content script로 그대로 씀)
    extract.ts  칸·버튼 추출, 라벨 탐지 다단계 fallback (aria → label → MUI FormControl → 표 th/열 머리글 → dl → 위·왼쪽 라벨 상자(폼 빌더 div.label·contenteditable 라벨) → 앞 글자 → placeholder)
    fill.ts     종류별 입력(React 제어 컴포넌트용 native setter, MUI Select/Autocomplete) + 검증 + 표시
    synonyms.ts 라벨·값 동의어 (응시일=시험일=취득시기, 만기전역=만기제대 …)
    input.ts    실제 마우스·키보드가 없는 환경(확장)의 흉내 입력과 진짜 입력용 좌표
    files.ts    파일 첨부 (DataTransfer, 형식·크기·발급일 확인, 드롭 영역)
    postcode.ts 다음 우편번호 검색 화면 조작
    login.ts    로그인 폼·CAPTCHA·2단계 인증·본인인증 화면 알아보기, 로그인 입력
    safety.ts   차단 규칙 (페이지 안과 Node 쪽이 같이 씀)
  transport.ts  BrowserHost/PageRef/FrameRef: 드라이버와 실행 환경 사이의 경계
  driver.ts     DomDriver (환경 무관: 스캔 캐시, 일괄 입력·검증·초기화 감지, 반복 행, 첨부, 주소 검색) + PlaywrightDriver
  pw-host.ts    Playwright로 BrowserHost 구현 (테스트·Claude Code용)
  ext-host.ts   크롬 확장으로 BrowserHost 구현 (WebSocket 브리지, 흉내 입력 → 안 되면 chrome.debugger 진짜 입력)
  bridge.ts     확장 브리지 프로토콜과 클라이언트 (127.0.0.1 WebSocket + 일회용 토큰)
  adapters.ts   사이트·ATS별 어댑터 캐시 (기본: adapters/*.json, 배운 것: data/adapters/*.json)
  files.ts      파일 보관함 (Playwright 모드: data/files, 확장 모드: 확장의 IndexedDB)
  browser.ts    전용 브라우저 실행/연결, 탭 선택, 확인창 처리
  server.ts     MCP 툴 정의, 서버 안내문
adapters/       기본 어댑터 (careerlink·ninehire·woowayouths 실사용 메모에서 옮김)
test/
  fixtures/legacy.html  표·dl 레이아웃의 옛날식 지원서 (iframe, 행 복제, confirm 포함)
  fixtures/mui/         careerlink와 같은 MUI v5 + MUI X DatePicker v6 지원서 (React 상태로 검증)
  fixtures/ats.html     kt.recruiter.co.kr(ats-) 구조: aria 없는 드롭다운, 키 입력 검색, 색으로만 표시하는 버튼 묶음
  fixtures/antd.html    ninehire(antd + 폼 빌더) 구조: div 드롭다운(portal 메뉴)·antd Select, contenteditable 라벨, 고르면 나타나는 칸, div 주소 칸
  fixtures/meritz/      기획서 3장(메리츠 실사용) 문제 재현: 국가번호+번호, 토글이 뒤 칸 초기화, 잠긴 칸 자동 채움, 최대 5개, 부분 저장, 형식 바꾸는 사이트
  fixtures/files.html   업로드 칸: accept·크기·발급일 안내, 숨긴 input, 이미 있는 파일, 드롭 영역, 팝업 필수 첨부
  fixtures/postcode.html 다음 우편번호 흉내(레이어 iframe·새 창), YBM·OPIc 버튼
  fixtures/login.html   로그인 폼, CAPTCHA, reCAPTCHA v3 배지, 2단계 인증, 본인인증, 가입 화면
  synthetic.ts          확장 흉내 모드: 실제 입력 대신 흉내 입력(CLF_SYNTHETIC=1)
  e2e/                  실제 Claude로 돌리는 종단 간 확인 (가짜 프로필 + 결과 대조)
```

```bash
npm test                 # 92개: 옛날식 · MUI · careerlink형 · ats형 · antd(ninehire)형 · 제한 폼 · 메리츠 재현 · 첨부 · 주소 · 로그인 · 실제 MCP 클라이언트
npm run test:synthetic   # 같은 fixture를 확장처럼 흉내 입력으로, 안 되면 진짜 입력으로 다시 (76개)
npm run typecheck
npm run e2e     # 실제 Claude로 종단 간 확인 (유료, 아래 참고)
```

테스트는 설치된 크롬/엣지를 헤드리스로 띄워요(Playwright 브라우저를 따로 받지 않아요).

### 종단 간 확인 (`npm run e2e`)

`npm test`는 "어느 칸에 무슨 값"을 테스트 코드가 정해 줘요. `npm run e2e`는 그 판단까지 실제 Claude에게 맡겨요.

1. 가짜 인물 프로필(`test/e2e/profile.json`)을 준비해요.
2. 헤드리스 `claude -p`에 "지원서를 내 프로필로 채워줘"라고만 시켜요. MCP 툴만 쓸 수 있고, 파일 읽기 같은 기본 툴과 다른 MCP는 꺼 둬요.
3. 끝나면 폼의 실제 상태를 프로필과 칸마다 대조해요.

결과는 툴 호출 순서, 턴 수, API 환산 비용과 함께 나와요. 지금 로그인된 Claude 계정으로 돌아서, 구독이면 따로 청구되지 않고 사용 한도에서 차감돼요. API 요금으로 환산하면 시나리오당 약 $0.15~0.25예요. 서버 자체는 API를 부르지 않아서 토큰을 쓰지 않아요.

| 시나리오 | 확인하는 것 |
|---|---|
| `mui` | careerlink형 MUI 폼. 날짜 선택기·드롭다운·자동완성, 선택 후 나타나는 칸, 자소서·동의·제출·임시저장을 건드리지 않는지 |
| `legacy` | 표 레이아웃 다단계 폼. 분할 칸(휴대폰·이메일), 날짜 형식 변환, 다음 단계 확인창, 프로필에 없는 값(취미·추천인)을 지어내지 않는지 |
| `limits` | 개수·글자 수 제한. 스킬 5칸, 수상 최대 3개(넘기면 알림창), 수상 내용 100자, 100byte 카운터, 대문자·YYYYMMDD 형식, 숫자만 받는 수험번호 |
| `ats` | kt.recruiter형. aria 없는 버튼 드롭다운, 키 입력에만 반응하는 학교 검색("등록하기"는 안 누르는지), 버튼 묶음, 페이지 안에 펼치는 전공 추가 |

`limits`는 기대값을 프로필에서 계산해서(칸 수 = min(제한, 프로필 개수) 등) 내 프로필로도 돌릴 수 있어요.

```bash
E2E_PROFILE=data/profile.json npm run e2e -- limits
```

## 환경변수

| 변수 | 기본값 | |
|---|---|---|
| `CAREERLOG_PROFILE` | `data/profile.json` | 프로필 파일 |
| `CAREERLOG_BROWSER_PROFILE` | `~/.careerlog/browser-profile` | 작업 브라우저 프로필 폴더 |
| `CAREERLOG_CDP_PORT` | `9333` | 작업 브라우저 디버깅 포트 |
| `CAREERLOG_BROWSER_PATH` | 크롬 → 엣지 순서로 자동 탐색 | 브라우저 실행 파일 |
| `CAREERLOG_BROWSER=launch`, `CAREERLOG_HEADLESS=1` | | 테스트용: Playwright가 직접 띄우는 헤드리스 모드 |
| `CAREERLOG_DATA_DIR` | `data/` | 프로필·어댑터·스냅샷·파일 보관함을 두는 폴더 |
| `CAREERLOG_FILES_DIR` | `data/files` | Playwright 모드 파일 보관함 (`node dist/index.js --add-file <경로> --kind 졸업증명서 --issued 2026-09-01`) |
| `CAREERLOG_BRIDGE`, `CAREERLOG_BRIDGE_TOKEN` | | 확장 모드. native host가 claude를 띄울 때 넣는다 (직접 설정하지 않음) |

## 알려진 한계

- careerlink 지원서 화면은 로그인 뒤에 있어서 실제 화면으로는 아직 검증하지 못했어요. 공개 공고 페이지(같은 MUI 컴포넌트)와 같은 버전으로 만든 테스트 폼으로만 확인했어요. 처음 쓸 때 칸 인식이 이상하면 `snapshot_page`로 저장해 두면 그 HTML로 고칠 수 있어요.
- 다음 우편번호 검색과 파일 첨부는 실제 서비스·사이트가 아니라 구조를 흉내 낸 fixture로만 확인했어요. 실제 우편번호 화면 구조가 다르면 `search_address`가 "검색 화면을 찾지 못했어요"를 돌려주고 사용자에게 맡겨요.
- YBM·OPIc 성적 연동은 실제 흐름을 몰라서 버튼 감지·안내·결과 칸 대기(`wait_for_user`)까지만 해요. 대신 눌러 주지 않아요.
- antd 계열(ninehire)은 실제 화면 HTML 없이 구조만 흉내 낸 테스트 폼으로 확인했어요. 검색형 antd Select(가상 스크롤로 앞쪽 선택지만 보이는 긴 목록)는 아직 목록 안 검색을 하지 않아요.
- careerlink는 세션 만료 시간이 있어요. 오래 두면 다시 로그인해야 할 수 있어요.
- 작업 브라우저의 디버깅 포트는 이 PC 안(127.0.0.1)에서만 열려요. 이 전용 프로필에는 채용 사이트 로그인만 두세요.
