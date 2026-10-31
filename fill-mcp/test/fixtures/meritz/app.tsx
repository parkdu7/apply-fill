// 메리츠증권 지원서(careerlink, 2026-10-28 실사용)에서 드러난 문제를 재현하는 테스트 페이지. MUI v5.
// 기획서 3장 번호:
//  1 라벨 동의어  — 자격 "취득시기", 대학 "기준 학점"·"재학기간(시작일)", 경력 "업무내용"
//  2 값 동의어    — 전역 구분 "만기제대"만 있음, 시험명 "TOEIC"만 있음
//  3 칸 의미 오해 — "긴급 연락처"가 [국가번호 자동완성][번호] 두 칸 (관계 "모"를 넣으면 모나코·모로코가 뜬다)
//  4 후보 접미사  — "한빛고등학교(경기) 일반고", "한국대학교(세종) / 분교"
//  5 토글 초기화  — 대학교 "대학교(국내/국외)" 토글을 누르면 학교명·주전공·학점·기준 학점·소재지가 비워진다 (토글이 학교명 뒤에 있음)
//  8 잠긴 칸      — 자격 "발행처"·어학 "취득시기"는 늘 잠겨 있고 앞 칸을 고르면 사이트가 채운다
//  9 개수 제한    — 학내외활동 5개 이후 추가 버튼이 아무 반응이 없다 (안내창 없음)
// 10 부분 저장    — 경력 "퇴직사유"는 뒤에 있는 "재직 상태"가 퇴직이어야 풀리고, "연봉"은 늘 잠겨 있다
// 13 형식 변환    — 긴급 연락처 번호는 칸을 떠나고 0.5초 뒤 하이픈을 지운다
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import type { Dayjs } from 'dayjs';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

const DIRECT = '직접입력시 클릭';
const DB = {
  high: ['한빛고등학교(경기) 일반고', '한빛고등학교(충남) 일반고', '한빛중학교'],
  univ: ['한국대학교 / 본교', '한국대학교(세종) / 분교', '한국사이버대학교 / 본교'],
  major: ['정보융합소프트웨어학과', '컴퓨터학과'],
  license: ['정보처리기사', 'SQL개발자(SQLD자격)', 'SQL전문가(SQLP자격)'],
};
const ISSUER: Record<string, string> = {
  정보처리기사: '한국산업인력공단',
  'SQL개발자(SQLD자격)': '한국데이터산업진흥원',
  'SQL전문가(SQLP자격)': '한국데이터산업진흥원',
};
const COUNTRIES = ['대한민국(+82)', '미국(+1)', '일본(+81)', '중국(+86)', '모나코(+377)', '모로코(+212)'];
const MAX_ACT = 5;

type Row = Record<string, string>;
type Section = 'HISC' | 'UNIV' | 'LCNS' | 'LANG' | 'ACT' | 'CARR';

const fmt = (d: Dayjs | null) => (d && d.isValid() ? d.format('YYYY.MM.DD') : '');

function AddIcon() {
  return (
    <svg focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="AddIcon" width="20" height="20">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="tabler-icon tabler-icon-pencil" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4" fill="none" stroke="currentColor" />
    </svg>
  );
}

/** DB 검색형 자동완성: 0.3초 뒤에 후보가 온다. 첫 후보는 항상 "직접입력시 클릭". 값이 비워지면(초기화) 입력 글자도 비운다 */
function DbField(props: { label: string; db: string[]; value: string; onChange: (v: string) => void; required?: boolean }) {
  const [input, setInput] = useState(props.value);
  const [options, setOptions] = useState<string[]>([]);
  const timer = useRef<number>();
  useEffect(() => {
    if (props.value === '') setInput('');
  }, [props.value]);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!input || input === props.value) return setOptions([]);
    timer.current = window.setTimeout(() => {
      const found = props.db.filter((o) => o.replace(/\s/g, '').includes(input.replace(/\s/g, '')));
      setOptions([DIRECT, ...found]);
    }, 300);
  }, [input]);
  return (
    <Autocomplete
      options={options}
      filterOptions={(x) => x}
      value={props.value || null}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      onChange={(_, v) => {
        if (v === DIRECT) props.onChange(input);
        else {
          const name = (v ?? '').split(' / ')[0];
          props.onChange(name);
          setInput(name);
        }
      }}
      isOptionEqualToValue={() => false}
      renderInput={(p) => <TextField {...p} label={props.label} required={props.required} />}
      sx={{ minWidth: 260 }}
    />
  );
}

function DateField(props: { label: string; value: Dayjs | null; onChange: (v: Dayjs | null) => void }) {
  return <DatePicker label={props.label} format="YYYY/MM/DD" value={props.value} onChange={props.onChange} />;
}

function SelectField(props: { label: string; value: string; options: string[]; onChange: (v: string) => void; required?: boolean; disabled?: boolean }) {
  const id = `sel-${props.label}`;
  return (
    <FormControl sx={{ minWidth: 160 }} required={props.required} disabled={props.disabled}>
      <InputLabel id={id}>{props.label}</InputLabel>
      <Select labelId={id} label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <MenuItem key={o} value={o}>
            {o}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function Toggle(props: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2">{props.label}</Typography>
      <ToggleButtonGroup exclusive size="small" value={props.value} onChange={(_, v) => v && props.onChange(v)}>
        {props.options.map((o) => (
          <ToggleButton key={o} value={o}>
            {o}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}

function SectionCard(props: { code: string; title: string; onAdd?: () => void; rows?: Row[]; summary?: (r: Row) => string; onEdit?: (i: number) => void; children?: ReactNode }) {
  return (
    <Card className={`resume-${props.code}`} sx={{ mt: 2 }}>
      <CardHeader
        title={<p style={{ margin: 0, fontWeight: 700 }}>{props.title}</p>}
        disableTypography
        action={
          props.onAdd && (
            <IconButton onClick={props.onAdd}>
              <AddIcon />
            </IconButton>
          )
        }
      />
      <CardContent>
        {props.children}
        {props.rows &&
          (props.rows.length ? (
            props.rows.map((r, i) => (
              <Box key={i} className="CareerGrid-container" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2">{props.summary?.(r)}</Typography>
                <IconButton size="small" onClick={() => props.onEdit?.(i)}>
                  <PencilIcon />
                </IconButton>
              </Box>
            ))
          ) : (
            <p className="resume-card-empty-text">작성한 내역이 없습니다.</p>
          ))}
      </CardContent>
    </Card>
  );
}

const EMPTY: Record<Section, Row> = {
  HISC: { school: '', region: '', end: '', grad: '' },
  UNIV: { abroad: '', school: '', major: '', region: '', gpaMax: '', gpa: '', start: '', end: '', grad: '' },
  LCNS: { name: '', issuer: '', date: '' },
  LANG: { lang: '', test: '', month: '', score: '', date: '' },
  ACT: { name: '', start: '' },
  CARR: { company: '', empType: '', reason: '', status: '', start: '', end: '', desc: '', salary: '' },
};
const REQUIRED: Record<Section, string[]> = {
  HISC: ['school', 'end'],
  UNIV: ['school', 'grad'],
  LCNS: ['name', 'date'],
  LANG: ['test', 'score'],
  ACT: ['name'],
  CARR: ['company'],
};
const TITLE: Record<Section, string> = { HISC: '고등학교', UNIV: '대학교', LCNS: '자격증', LANG: '어학', ACT: '학내외활동사항', CARR: '경력사항' };

function App() {
  const [apply, setApply] = useState({ name: '', emCc: '', emPhone: '', emRel: '', military: '', discharge: '' });
  const [rows, setRows] = useState<Record<Section, Row[]>>({ HISC: [], UNIV: [], LCNS: [], LANG: [], ACT: [], CARR: [] });
  const [editing, setEditing] = useState<{ sec: Section; index: number | null; row: Row; dates: Record<string, Dayjs | null> } | null>(null);
  const [error, setError] = useState('');
  const [discarded, setDiscarded] = useState(0);
  const [resets, setResets] = useState(0);
  const [ccInput, setCcInput] = useState('');

  (window as unknown as { __fixtureState: unknown }).__fixtureState = { apply, rows, editing: editing?.sec ?? null, discarded, resets, ccInput };

  const open = (sec: Section, index: number | null = null) => {
    // 9: 최대 개수가 넘으면 아무 반응도 없다
    if (index === null && sec === 'ACT' && rows.ACT.length >= MAX_ACT) return;
    const row = index === null ? { ...EMPTY[sec] } : { ...rows[sec][index] };
    setError('');
    setEditing({ sec, index, row, dates: {} });
  };
  const set = (k: string, v: string) => setEditing((e) => e && { ...e, row: { ...e.row, [k]: v } });
  const setDate = (k: string, v: Dayjs | null) =>
    setEditing((e) => {
      if (!e) return e;
      const row = { ...e.row, [k]: fmt(v) };
      // 8: 어학 취득시기는 응시일에서 사이트가 채운다
      if (e.sec === 'LANG' && k === 'date') row.month = v && v.isValid() ? v.format('YYYY.MM') : '';
      return { ...e, dates: { ...e.dates, [k]: v }, row };
    });
  const close = () => {
    setDiscarded((n) => n + 1);
    setEditing(null);
  };
  const save = () => {
    if (!editing) return;
    const missing = REQUIRED[editing.sec].filter((k) => !editing.row[k]);
    if (missing.length) return setError('필수 항목을 입력해 주세요.');
    setRows((r) => {
      const list = [...r[editing.sec]];
      if (editing.index === null) list.push(editing.row);
      else list[editing.index] = editing.row;
      return { ...r, [editing.sec]: list };
    });
    setEditing(null);
  };
  const stripLater = () => window.setTimeout(() => setApply((a) => ({ ...a, emPhone: a.emPhone.replace(/\D/g, '') })), 500);

  const e = editing;
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <nav className="builder-box-current-page-jobs">
        <Box p={3} maxWidth={1000}>
          <Typography variant="h5">2026 테스트증권 신입사원 채용 지원서</Typography>

          <SectionCard code="PSN_INFO" title="인적정보">
            <Stack direction="row" spacing={2}>
              <TextField label="이름" required value={apply.name} onChange={(ev) => setApply({ ...apply, name: ev.target.value })} />
            </Stack>
            <Stack direction="row" spacing={2} mt={2}>
              <Autocomplete
                options={COUNTRIES}
                value={apply.emCc || null}
                inputValue={ccInput}
                onInputChange={(_, v) => setCcInput(v)}
                onChange={(_, v) => setApply((a) => ({ ...a, emCc: v ?? '' }))}
                renderInput={(p) => <TextField {...p} label="긴급 연락처" />}
                sx={{ minWidth: 200 }}
              />
              <TextField
                label="긴급 연락처"
                value={apply.emPhone}
                onChange={(ev) => setApply({ ...apply, emPhone: ev.target.value })}
                onBlur={stripLater}
              />
              <SelectField label="긴급 연락처 관계" value={apply.emRel} options={['부', '모', '형제', '배우자', '기타']} onChange={(v) => setApply({ ...apply, emRel: v })} />
            </Stack>
          </SectionCard>

          <SectionCard code="MLTR_INFO" title="병역사항">
            <Stack direction="row" spacing={2}>
              <SelectField label="병역 구분" value={apply.military} options={['군필', '미필', '면제', '해당없음']} onChange={(v) => setApply({ ...apply, military: v })} />
              <SelectField label="전역 구분" value={apply.discharge} options={['만기제대', '의가사제대', '의병제대', '소집해제']} onChange={(v) => setApply({ ...apply, discharge: v })} />
            </Stack>
          </SectionCard>

          <SectionCard code="HISC_INFO" title="고등학교" onAdd={() => open('HISC')} rows={rows.HISC} summary={(r) => `${r.school} ${r.end}`} onEdit={(i) => open('HISC', i)} />
          <SectionCard code="UNIV_INFO" title="대학교" onAdd={() => open('UNIV')} rows={rows.UNIV} summary={(r) => `${r.school} ${r.grad}`} onEdit={(i) => open('UNIV', i)} />
          <SectionCard code="LCNS_INFO" title="자격증" onAdd={() => open('LCNS')} rows={rows.LCNS} summary={(r) => `${r.name} ${r.issuer}`} onEdit={(i) => open('LCNS', i)} />
          <SectionCard code="LANG_INFO" title="어학" onAdd={() => open('LANG')} rows={rows.LANG} summary={(r) => `${r.test} ${r.score}`} onEdit={(i) => open('LANG', i)} />
          <SectionCard code="ACT_INFO" title="학내외활동사항" onAdd={() => open('ACT')} rows={rows.ACT} summary={(r) => `${r.name} ${r.start}`} onEdit={(i) => open('ACT', i)} />
          <SectionCard code="CARR_INFO" title="경력사항" onAdd={() => open('CARR')} rows={rows.CARR} summary={(r) => `${r.company} ${r.empType}`} onEdit={(i) => open('CARR', i)} />

          <Stack direction="row" spacing={1} mt={3}>
            <Button variant="outlined">임시저장</Button>
            <Button variant="contained">최종제출</Button>
          </Stack>
        </Box>

        <Dialog open={!!e} onClose={close} maxWidth="md" fullWidth>
          {e && (
            <>
              <DialogTitle>{TITLE[e.sec]}</DialogTitle>
              <DialogContent>
                <Stack spacing={2} mt={1}>
                  {e.sec === 'HISC' && (
                    <>
                      <DbField label="학교명" required db={DB.high} value={e.row.school} onChange={(v) => set('school', v)} />
                      <SelectField label="소재지" value={e.row.region} options={['서울', '경기', '충남', '세종']} onChange={(v) => set('region', v)} />
                      <DateField label="졸업일" value={e.dates.end ?? null} onChange={(v) => setDate('end', v)} />
                      <SelectField label="졸업 구분" value={e.row.grad} options={['졸업', '졸업예정', '검정고시']} onChange={(v) => set('grad', v)} />
                    </>
                  )}
                  {e.sec === 'UNIV' && (
                    <>
                      <DbField label="학교명" required db={DB.univ} value={e.row.school} onChange={(v) => set('school', v)} />
                      <DbField label="주전공" db={DB.major} value={e.row.major} onChange={(v) => set('major', v)} />
                      <SelectField label="학교소재지" value={e.row.region} options={['서울', '경기', '세종', '부산']} onChange={(v) => set('region', v)} />
                      <Stack direction="row" spacing={2}>
                        <SelectField label="기준 학점" value={e.row.gpaMax} options={['4.5', '4.3', '4.0', '100']} onChange={(v) => set('gpaMax', v)} />
                        <TextField label="학점" value={e.row.gpa} onChange={(ev) => set('gpa', ev.target.value)} />
                      </Stack>
                      <Toggle
                        label="대학교(국내/국외)"
                        value={e.row.abroad}
                        options={['국내', '국외']}
                        onChange={(v) => {
                          // 5: 토글을 누르면 이미 넣은 칸이 비워진다
                          setResets((n) => n + 1);
                          setEditing((x) => x && { ...x, row: { ...x.row, abroad: v, school: '', major: '', region: '', gpaMax: '', gpa: '' } });
                        }}
                      />
                      <Stack direction="row" spacing={2}>
                        <DateField label="재학기간(시작일)" value={e.dates.start ?? null} onChange={(v) => setDate('start', v)} />
                        <DateField label="재학기간(종료일)" value={e.dates.end ?? null} onChange={(v) => setDate('end', v)} />
                      </Stack>
                      <SelectField label="졸업 구분" required value={e.row.grad} options={['졸업', '졸업예정', '재학', '휴학']} onChange={(v) => set('grad', v)} />
                    </>
                  )}
                  {e.sec === 'LCNS' && (
                    <>
                      <DbField
                        label="자격증명"
                        required
                        db={DB.license}
                        value={e.row.name}
                        onChange={(v) => setEditing((x) => x && { ...x, row: { ...x.row, name: v, issuer: ISSUER[v] ?? '' } })}
                      />
                      <TextField label="발행처" value={e.row.issuer} disabled onChange={(ev) => set('issuer', ev.target.value)} />
                      <DateField label="취득시기" value={e.dates.date ?? null} onChange={(v) => setDate('date', v)} />
                    </>
                  )}
                  {e.sec === 'LANG' && (
                    <>
                      <SelectField label="외국어" value={e.row.lang} options={['영어', '일본어', '중국어']} onChange={(v) => set('lang', v)} />
                      <SelectField label="시험명" required value={e.row.test} options={['TOEIC', 'TOEIC Speaking', 'OPIc', 'TEPS']} onChange={(v) => set('test', v)} />
                      <TextField label="취득시기" value={e.row.month} disabled />
                      <TextField label="점수" value={e.row.score} onChange={(ev) => set('score', ev.target.value)} />
                      <DateField label="응시일" value={e.dates.date ?? null} onChange={(v) => setDate('date', v)} />
                    </>
                  )}
                  {e.sec === 'ACT' && (
                    <>
                      <TextField label="활동명" required value={e.row.name} onChange={(ev) => set('name', ev.target.value)} />
                      <DateField label="활동기간(시작일)" value={e.dates.start ?? null} onChange={(v) => setDate('start', v)} />
                    </>
                  )}
                  {e.sec === 'CARR' && (
                    <>
                      <TextField label="회사명" required value={e.row.company} onChange={(ev) => set('company', ev.target.value)} />
                      <SelectField label="고용형태" value={e.row.empType} options={['정규직', '계약직', '인턴']} onChange={(v) => set('empType', v)} />
                      <SelectField label="퇴직사유" disabled={e.row.status !== '퇴직'} value={e.row.reason} options={['계약만료', '개인사유', '기타']} onChange={(v) => set('reason', v)} />
                      <SelectField label="재직 상태" value={e.row.status} options={['재직중', '퇴직']} onChange={(v) => set('status', v)} />
                      <Stack direction="row" spacing={2}>
                        <DateField label="입사일" value={e.dates.start ?? null} onChange={(v) => setDate('start', v)} />
                        <DateField label="퇴사일" value={e.dates.end ?? null} onChange={(v) => setDate('end', v)} />
                      </Stack>
                      <TextField label="업무내용" multiline minRows={2} value={e.row.desc} onChange={(ev) => set('desc', ev.target.value)} />
                      <TextField label="연봉" value={e.row.salary} disabled />
                    </>
                  )}
                  {error && <Typography color="error">{error}</Typography>}
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button variant="contained" onClick={save}>
                  저장하기
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      </nav>
    </LocalizationProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
