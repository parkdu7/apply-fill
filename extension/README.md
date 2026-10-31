# CareerLog 크롬 확장 (v2)

지원서 페이지에서 사이드패널의 **[채우기]** 한 번이면 프로필의 기본정보가 들어가는 크롬 확장이에요.
칸을 읽고 넣는 코드는 `../fill-mcp`의 `src/dom`을 그대로 쓰고, 판단은 내 PC의 Claude Code CLI(`claude -p`)가 해요.
API 키는 필요 없어요. Claude 구독 계정으로 로그인한 CLI를 그대로 써요.

- 제출·최종제출·지원하기·미리보기·삭제 버튼은 코드에서 막혀 있어요. 제출은 항상 사람이 해요.
- 이미 값이 있는 칸은 덮어쓰지 않아요. 자기소개서·동의·민감정보(주민번호·계좌 등)는 넣지 않아요. Escape 키도 보내지 않아요.
- 파일은 **파일 보관함**에 넣어 둔 것만 첨부해요. 파일 내용은 Claude에게 가지 않아요(이름·종류·크기·발급일만).
- 로그인은 **계정 보관함**에 저장한 그 사이트(정확히 같은 주소) 계정만 써요. 비밀번호는 Claude·도구 결과·로그 어디에도 들어가지 않아요.
  CAPTCHA·2단계 인증·본인인증 화면이면 멈추고 직접 하라고 알려 줘요.

## 설치 (처음 한 번)

Node.js 22 이상, 크롬, 로그인된 Claude Code가 필요해요. 이 저장소 루트(`career_log`)에서:

**1. fill-mcp 빌드**

```bash
cd fill-mcp && npm install && npm run build
```

**2. 확장 빌드** (처음 빌드할 때 확장 키를 `.keys/`에 만들어요. 이 키 덕분에 확장 ID가 항상 같아요)

```bash
cd extension && npm install && npm run build
```

`dist/`(확장)와 `host/dist/host.mjs`(native host)가 생겨요. 확장 ID는 `.keys/extension-id.txt`에 있어요.
이 저장소에서 만든 키라면 `aebnlfaandceeplppkpbfbicoopnndnp`이에요. `.keys/`는 커밋하지 않아요(지우면 ID가 바뀌어서 3번을 다시 해야 해요).

**3. native host 등록** (현재 사용자 레지스트리 `HKCU`에만 써요. 관리자 권한 필요 없음)

```bash
cd extension && npm run install-host
```

하는 일:
- `host/config.json`: 지금 쓰는 node 경로와 fill-mcp 경로
- `host/careerlog-host.bat`: 크롬이 띄우는 실행 파일
- `host/careerlog-host.json`: 호스트 매니페스트. `allowed_origins`에는 **이 확장 ID 하나만** 들어가요
- 레지스트리 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.careerlog.host` → 위 매니페스트 경로

무엇을 바꿀지 먼저 보고 싶으면 `node scripts/install-host.mjs --dry-run`. fill-mcp를 다른 곳에 두었으면 `--fill-mcp <dist/index.js 경로>`.

**4. 크롬에 확장 불러오기** (직접 해 주세요)

1. 크롬 주소창에 `chrome://extensions`
2. 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → `career_log/extension/dist` 폴더 선택
4. 카드에 보이는 ID가 `.keys/extension-id.txt`와 같은지 확인 (다르면 native host가 연결을 거부해요)
5. 퍼즐 아이콘에서 CareerLog를 고정하고 누르면 사이드패널이 열려요

**5. Claude 로그인 확인**

사이드패널 위쪽에 "Claude 준비됨"이 보이면 끝이에요. "로그인 필요"면 패널의 **로그인** 버튼을 누르거나 터미널에서 `claude`를 한 번 실행해 로그인해 주세요.
CLI는 PATH의 `claude`와 Claude 데스크톱 앱에 들어 있는 CLI 중 가장 새 버전을 골라요. 특정 CLI를 쓰려면 `host/config.json`에 `"claude": "<경로>"`를 넣어요.

## 쓰는 법

1. **[프로필]** 탭에서 프로필(JSON)을 확인·수정해요. fill-mcp와 같은 `fill-mcp/data/profile.json`을 써요.
2. (필요하면) **[파일]** 탭에 증명서를 넣어 둬요. 종류(졸업증명서·성적증명서 …)와 발급일을 같이 적으면 "3개월 이내 발급" 같은 안내를 확인해요.
3. (필요하면) **[계정]** 탭에서 마스터 비밀번호로 보관함을 만들고 사이트 계정을 추가해요.
4. 지원서 페이지를 열고 **[실행]** 탭의 **[채우기]**. 진행 상황이 로그에 실시간으로 보여요.
   - 프로필에 없는 값이 필요하면 질문이 한 번에 올라와요. 답하고 **[이어서]**를 누르면 같은 대화로 계속해요.
   - 노란색 칸은 "확인 필요"(추정·형식 변환), 초록색은 확인된 값이에요.
   - **[멈춤]**은 바로 멈춰요. 모델은 기본/Sonnet/Haiku/Opus 중 고를 수 있어요.
5. 끝나면 요약(채운 것, 확인 필요, 직접 할 일)을 보고 **제출은 직접** 해요.

비용 표시는 API 요금으로 환산한 값(참고용)이에요. 구독 계정이면 실제로는 구독 사용 한도에서 빠져요.

### 알아 두면 좋은 것

- **"CareerLog이(가) 이 브라우저를 디버깅하는 중입니다" 줄**: React·검색 팝업처럼 흉내 입력을 받지 않는 칸만 `chrome.debugger`로 진짜 클릭·키 입력을 보내요. 그동안 이 안내 줄이 잠깐 떠요. 정상이에요. 흉내 입력으로 되는 칸은 디버거를 쓰지 않아요.
- 성적 조회(YBM·OPIc)·본인인증 같은 다른 사이트 화면은 대신 하지 않아요. 안내가 뜨면 직접 하고 기다리면, 끝난 뒤 값이 프로필과 맞는지 다시 확인해요.
- 계정 보관함은 30분 동안 쓰지 않으면 잠겨요. 크롬을 끄면 바로 잠겨요. 마스터 비밀번호는 저장하지 않아서 잊으면 보관함을 지우고 새로 만들어야 해요.
- 로그인이 틀리면 다시 시도하지 않아요(계정 잠김 방지). 로그인 기록에는 시간·사이트·결과만 남아요.

### 권한

| 권한 | 왜 |
|---|---|
| `nativeMessaging` | 내 PC의 host(→ claude CLI)와 이야기하려고 |
| `sidePanel` | 사이드패널 UI |
| `scripting`, `webNavigation`, `tabs`, 모든 http/https 사이트 | 지원서 페이지(와 그 안의 iframe)에 칸 읽기·넣기 코드를 넣고, 새로 열린 탭을 따라가려고 |
| `storage`, `unlimitedStorage` | 설정, 암호화된 계정 보관함, 파일 보관함(IndexedDB) |
| `alarms` | 계정 보관함 30분 자동 잠금 |
| `debugger` | 흉내 입력이 안 되는 칸에만 진짜 마우스·키 입력 |

## 지우기

```bash
cd extension && npm run uninstall-host
```

그리고 `chrome://extensions`에서 확장을 삭제하면 끝이에요(파일·계정 보관함도 같이 지워져요). host 로그는 `%LOCALAPPDATA%\CareerLog\host.log`에 있어요.

## 구조

```
사이드패널 ──port── background(service worker) ──native messaging── host (node)
                       │                                              │ claude -p --output-format stream-json
                       │ chrome.scripting / tabs.sendMessage           │   --mcp-config {careerlog-fill} --strict-mcp-config
                       ▼                                              │   --allowedTools mcp__careerlog-fill --tools ""
                   content script (fill-mcp src/dom)                   ▼
                                                                    fill-mcp (MCP 서버, 확장 모드)
                       ▲                                              │
                       └──── host가 중계 ◀── 127.0.0.1 WebSocket (일회용 토큰) ──┘
```

- `src/background/index.ts`: 작업 탭 추적, 프레임마다 content script 호출, 진짜 입력(chrome.debugger), 파일·계정 보관함, 로그인
- `src/content/`: 페이지 안 코드. `dialog-shim`은 페이지 world에서 확인창을 대신 처리(에이전트가 동작 중일 때만), `index`는 fill-mcp `src/dom` + 메시지 처리
- `src/shared/vault.ts`: 계정 보관함. 마스터 비밀번호 → PBKDF2(SHA-256, 60만 회) → AES-GCM. 계정은 정확한 origin에 묶여요
- `src/shared/login-flow.ts`: 로그인 순서(인증 화면이면 멈춤 → 잠겨 있으면 멈춤 → 같은 origin 계정만 → 한 번만 시도)
- `src/shared/files-db.ts`: 파일 보관함(IndexedDB)
- `host/src/`: native host. `claude.ts`(CLI 찾기·실행·stream-json 해석), `bridge-server.ts`(fill-mcp가 붙는 WebSocket: 127.0.0.1, 일회용 토큰, Origin 헤더가 있으면 거부), `main.ts`
- 비밀번호 흐름: 계정 보관함(확장) → background가 복호화 → 그 프레임의 content script로 바로. host·fill-mcp·Claude에는 `login` 결과 상태(logged_in/challenge/failed …)만 가요

## 테스트

```bash
cd extension
npm run typecheck
npm run build:host && npm test
```

- `test/host.test.ts`: 진짜 host 프로세스를 띄우고, 가짜 크롬(Playwright가 띄운 페이지 + content script 코드)과 가짜 claude(`test/fake-claude.mjs`)로 전체 중계를 확인해요. 가짜 claude가 진짜 fill-mcp를 MCP로 호출하고, fill-mcp는 WebSocket 브리지로 페이지에 넣어요
- `test/vault.test.ts`: 암호화, origin 묶기, 로그인 흐름(잠김·계정 없음·틀린 비밀번호 한 번만·성공·CAPTCHA·origin 불일치), 결과·기록에 비밀번호가 없는지

fill-mcp 쪽의 `npm run test:synthetic`은 같은 fixture들을 확장처럼 흉내 입력(+ 안 되면 진짜 입력)으로 채워 봐요.

## 확인하지 못한 것 (알려진 한계)

- 실제 크롬에 확장을 불러와서 돌려 보지는 못했어요. 브랜드 크롬 137+는 `--load-extension`을 막아서 자동 테스트로 띄울 수 없어요.
  background의 chrome API 연결, chrome.debugger 진짜 입력, IndexedDB, 사이드패널 화면은 타입 검사와 코드 확인까지만 했어요. 처음 불러온 뒤 문제가 보이면 `chrome://extensions`의 "오류"와 service worker 콘솔을 봐 주세요.
- 실제 지원서·실제 로그인·실제 다음 우편번호·YBM·OPIc 화면에서는 시도하지 않았어요. 모두 구조를 흉내 낸 fixture로만 확인했어요.
- 페이지를 떠날 때 뜨는 "사이트에서 나가시겠습니까?"(beforeunload) 창은 확장 모드에서 대신 처리하지 않아요.
- Windows 기준으로 만들었어요. macOS·Linux용 매니페스트 위치도 install-host에 넣었지만 돌려 보지는 않았어요.
