# apply-fill

채용 지원서의 기본정보(인적사항, 학력, 병역, 자격증, 어학 등)를 내 프로필로 채워 주는 도구예요. 판단은 Claude가 하고, 입력·검증·안전장치는 코드가 맡아요. 제출은 항상 사람이 해요.

| 폴더 | 내용 |
|---|---|
| [`extension/`](extension/README.md) | 크롬 확장. 사이드패널 [채우기] 한 번으로 평소 크롬에서 채워요. 내 PC의 Claude Code(구독 로그인)를 native messaging으로 실행해요 |
| [`fill-mcp/`](fill-mcp/README.md) | MCP 서버. 칸 추출·입력·검증 로직(`src/dom`)과 도구(`extract_fields`, `fill_fields`, `add_rows` …). 확장과 Playwright 둘 다로 동작해요 |

지원 사이트 예: careerlink(MUI), ninehire(antd), kt.recruiter(ats), woowayouths, 옛날식 표 레이아웃.

## 안전장치

- 제출·최종제출·지원하기·삭제 버튼은 코드에서 막혀 있어요.
- 이미 값이 있는 칸은 덮어쓰지 않고, 자기소개서·동의·민감정보(주민번호·계좌) 칸은 채우지 않아요.
- 계정 비밀번호는 Claude에 보내지 않아요. 확장 안에서 암호화해 두고 코드가 직접 넣어요.

개인 프로필(`fill-mcp/data/`)은 저장소에 올라가지 않아요. `fill-mcp/profile.example.json`을 복사해서 쓰세요.
