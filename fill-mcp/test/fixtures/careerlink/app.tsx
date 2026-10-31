// careerlink 지원서(2026-10-22 실제 스냅샷) 구조를 흉내 낸 테스트 페이지. MUI v5.
// - 본문 전체가 <nav> 안, 섹션은 Card(resume-*) + CardHeader + AddIcon 버튼
// - 반복 섹션은 + → 편집 팝업(Dialog) → "저장하기"를 눌러야 행이 남는다. Escape로 닫히면 입력값이 버려진다.
// - 학교명·전공·자격증명은 DB 자동완성(첫 후보 "직접입력시 클릭"), 결과는 늦게 온다.
// - 국내/국외, 부전공 구분, 편입 여부는 토글 버튼. 가산점은 아이콘 + 글자로 된 커스텀 체크.
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
  school: ['한빛고등학교', '한빛중학교', '한국대학교 / 본교', '한국대학교(세종) / 분교', '한국사이버대학교 / 본교', '서울대학교 / 본교'],
  major: ['정보융합소프트웨어학과', '컴퓨터학과', '컴퓨터공학과', '소프트웨어학과'],
  license: ['정보처리기사', '정보처리산업기사', 'SQL개발자(SQLD자격)', 'SQL전문가(SQLP자격)'],
};
const ISSUER: Record<string, string> = {
  정보처리기사: '한국산업인력공단',
  정보처리산업기사: '한국산업인력공단',
  'SQL개발자(SQLD자격)': '한국데이터산업진흥원',
  'SQL전문가(SQLP자격)': '한국데이터산업진흥원',
};
const MAX_EXPC = 5;

type Row = Record<string, string>;
type Section = 'HISC' | 'UNIV' | 'LCNS' | 'EXPC';

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

function RadioIcon({ on }: { on: boolean }) {
  return (
    <svg focusable="false" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" data-testid={on ? 'RadioButtonCheckedIcon' : 'RadioButtonUncheckedIcon'}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" />
      {on && <circle cx="12" cy="12" r="5" />}
    </svg>
  );
}

/** DB 검색형 자동완성: 글자를 치면 0.4초 뒤에 후보가 온다. 첫 후보는 항상 "직접입력시 클릭" */
function DbField(props: { label: string; db: string[]; value: string; onChange: (v: string) => void; required?: boolean }) {
  const [input, setInput] = useState(props.value);
  const [options, setOptions] = useState<string[]>([]);
  const timer = useRef<number>();
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!input || input === props.value) return setOptions([]);
    timer.current = window.setTimeout(() => {
      const found = props.db.filter((o) => o.replace(/\s/g, '').includes(input.replace(/\s/g, '')));
      setOptions([DIRECT, ...found]);
    }, 400);
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
      sx={{ minWidth: 240 }}
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

/** 섹션 카드: 제목 + 추가 버튼 + 저장된 행 목록 */
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
  HISC: { school: '', grad: '', start: '', end: '', region: '' },
  UNIV: { abroad: '국내', school: '', major: '', minorType: '', region: '', gpaMax: '', gpa: '', grad: '', start: '', end: '', dayNight: '', campus: '', entry: '' },
  LCNS: { name: '', issuer: '', date: '', no: '' },
  EXPC: { type: '', org: '', start: '', end: '', desc: '' },
};

function App() {
  const [apply, setApply] = useState({ job: '', name: '홍길동', enName: 'HONG GIL DONG', phone: '', disability: false, veteran: false });
  const [rows, setRows] = useState<Record<Section, Row[]>>({ HISC: [], UNIV: [], LCNS: [], EXPC: [] });
  const [editing, setEditing] = useState<{ sec: Section; index: number | null; row: Row; dates: Record<string, Dayjs | null> } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [discarded, setDiscarded] = useState(0);
  const [saved, setSaved] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  (window as unknown as { __fixtureState: unknown }).__fixtureState = { apply, rows, editing: editing?.sec ?? null, discarded, saved, submitted };

  const open = (sec: Section, index: number | null = null) => {
    if (index === null && sec === 'EXPC' && rows.EXPC.length >= MAX_EXPC) return setNotice(`최대 등록 가능한 개수는 ${MAX_EXPC}개 입니다.`);
    const row = index === null ? { ...EMPTY[sec] } : { ...rows[sec][index] };
    setError('');
    setEditing({ sec, index, row, dates: {} });
  };
  const set = (k: string, v: string) => setEditing((e) => e && { ...e, row: { ...e.row, [k]: v } });
  const setDate = (k: string, v: Dayjs | null) => setEditing((e) => e && { ...e, dates: { ...e.dates, [k]: v }, row: { ...e.row, [k]: fmt(v) } });
  const close = () => {
    setDiscarded((n) => n + 1); // 저장 안 하고 닫힘 → 입력값 버려짐
    setEditing(null);
  };
  const REQUIRED: Record<Section, string[]> = { HISC: ['school', 'grad', 'end'], UNIV: ['school', 'major', 'grad', 'start', 'end'], LCNS: ['name', 'date'], EXPC: ['type', 'org', 'start'] };
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

  const e = editing;
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <nav className="builder-box-current-page-jobs">
        <Box p={3} maxWidth={1000}>
          <Typography variant="h5">2026년 테스트저축은행 신입직원 공개채용 지원서</Typography>

          <SectionCard code="APPLY_INFO" title="지원정보">
            <SelectField label="지원 직무" required value={apply.job} options={['금융일반', 'IT전산']} onChange={(v) => setApply({ ...apply, job: v })} />
          </SectionCard>

          <SectionCard code="PSN_INFO" title="인적정보">
            <Stack direction="row" spacing={2}>
              <TextField label="이름" required value={apply.name} onChange={(ev) => setApply({ ...apply, name: ev.target.value })} />
              <TextField label="영문 이름" required value={apply.enName} onChange={(ev) => setApply({ ...apply, enName: ev.target.value })} />
              <TextField label="휴대폰 번호" required value={apply.phone} onChange={(ev) => setApply({ ...apply, phone: ev.target.value })} />
            </Stack>
          </SectionCard>

          <SectionCard code="ADD_PNT_INFO" title="가산점">
            {(['disability', 'veteran'] as const).map((k) => (
              <div key={k} id={`center-${k}`} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setApply((a) => ({ ...a, [k]: !a[k] }))}>
                <RadioIcon on={apply[k]} />
                <p style={{ margin: 0 }}>{k === 'disability' ? '장애 여부' : '보훈 대상 여부'}</p>
              </div>
            ))}
          </SectionCard>

          <SectionCard code="HISC_INFO" title="고등학교" onAdd={() => open('HISC')} rows={rows.HISC} summary={(r) => `${r.end} ${r.grad} ${r.school}`} onEdit={(i) => open('HISC', i)} />
          <SectionCard code="UNIV_INFO" title="대학교" onAdd={() => open('UNIV')} rows={rows.UNIV} summary={(r) => `${r.start}~${r.end} ${r.grad} ${r.school}`} onEdit={(i) => open('UNIV', i)} />
          <SectionCard code="LCNS_INFO" title="자격사항" onAdd={() => open('LCNS')} rows={rows.LCNS} summary={(r) => `${r.name} ${r.issuer} ${r.date}`} onEdit={(i) => open('LCNS', i)} />
          <SectionCard code="EXPC_INFO" title="경험사항" onAdd={() => open('EXPC')} rows={rows.EXPC} summary={(r) => `${r.org} ${r.type} ${r.start}`} onEdit={(i) => open('EXPC', i)} />

          <Stack direction="row" spacing={1} mt={3}>
            <Button variant="outlined" onClick={() => setSaved((s) => s + 1)}>
              임시저장
            </Button>
            <Button variant="outlined">미리보기</Button>
            <Button variant="contained" onClick={() => setSubmitted(true)}>
              최종제출
            </Button>
          </Stack>
        </Box>

        <Dialog open={!!e} onClose={close} maxWidth="md" fullWidth>
          {e && (
            <>
              <DialogTitle>{{ HISC: '고등학교', UNIV: '대학교', LCNS: '자격사항', EXPC: '경험사항' }[e.sec]}</DialogTitle>
              <DialogContent>
                <Stack spacing={2} mt={1}>
                  {e.sec === 'HISC' && (
                    <>
                      <DbField label="학교명" required db={DB.school} value={e.row.school} onChange={(v) => set('school', v)} />
                      <SelectField label="졸업 구분" required value={e.row.grad} options={['졸업', '졸업예정', '검정고시']} onChange={(v) => set('grad', v)} />
                      <DateField label="입학일" value={e.dates.start ?? null} onChange={(v) => setDate('start', v)} />
                      <DateField label="졸업일" value={e.dates.end ?? null} onChange={(v) => setDate('end', v)} />
                      <SelectField label="소재지" value={e.row.region} options={['서울', '경기', '인천', '세종', '기타']} onChange={(v) => set('region', v)} />
                    </>
                  )}
                  {e.sec === 'UNIV' && (
                    <>
                      <Toggle label="국내/국외" value={e.row.abroad} options={['국내', '국외']} onChange={(v) => set('abroad', v)} />
                      <DbField
                        label="학교명"
                        required
                        db={DB.school}
                        value={e.row.school}
                        onChange={(v) =>
                          setEditing((x) => x && { ...x, row: { ...x.row, school: v, region: v.includes('세종') ? '세종' : v ? '서울' : '', campus: v.includes('(세종)') ? '분교' : v ? '본교' : '' } })
                        }
                      />
                      <DbField label="주전공" required db={DB.major} value={e.row.major} onChange={(v) => set('major', v)} />
                      <Toggle label="부전공 구분" value={e.row.minorType} options={['부전공', '복수전공', '이중전공', '해당없음']} onChange={(v) => set('minorType', v)} />
                      <SelectField label="학교소재지" value={e.row.region} options={['서울', '경기', '세종', '부산', '기타']} onChange={(v) => set('region', v)} />
                      <Stack direction="row" spacing={2}>
                        <SelectField label="기준 학점" value={e.row.gpaMax} options={['4.5', '4.3', '4.0', '100']} onChange={(v) => set('gpaMax', v)} />
                        <TextField label="학점" value={e.row.gpa} onChange={(ev) => set('gpa', ev.target.value)} />
                        <SelectField label="졸업 구분" required value={e.row.grad} options={['졸업', '졸업예정', '재학', '휴학', '중퇴', '수료']} onChange={(v) => set('grad', v)} />
                      </Stack>
                      <Stack direction="row" spacing={2}>
                        <DateField label="재학기간(시작일)" value={e.dates.start ?? null} onChange={(v) => setDate('start', v)} />
                        <DateField label="재학기간(종료일)" value={e.dates.end ?? null} onChange={(v) => setDate('end', v)} />
                      </Stack>
                      <Stack direction="row" spacing={2}>
                        <SelectField label="주/야간" value={e.row.dayNight} options={['주간', '야간']} onChange={(v) => set('dayNight', v)} />
                        <SelectField label="본/분교" value={e.row.campus} options={['본교', '분교']} onChange={(v) => set('campus', v)} />
                      </Stack>
                      <Toggle label="편입 여부" value={e.row.entry} options={['신규입학', '편입']} onChange={(v) => set('entry', v)} />
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
                      <TextField label="발행기관" value={e.row.issuer} disabled={!!ISSUER[e.row.name]} onChange={(ev) => set('issuer', ev.target.value)} />
                      <DateField label="취득년월" value={e.dates.date ?? null} onChange={(v) => setDate('date', v)} />
                      <TextField label="자격번호" value={e.row.no} onChange={(ev) => set('no', ev.target.value)} />
                    </>
                  )}
                  {e.sec === 'EXPC' && (
                    <>
                      <SelectField label="경험구분" required value={e.row.type} options={['교육이수', '대외활동', '수상내역', '해외경험', '기타']} onChange={(v) => set('type', v)} />
                      <TextField label="경험단체명" required value={e.row.org} inputProps={{ maxLength: 25 }} helperText="경험 기관명을 기입해 주세요" onChange={(ev) => set('org', ev.target.value)} />
                      <Stack direction="row" spacing={2}>
                        <DateField label="경험기간(시작일)" value={e.dates.start ?? null} onChange={(v) => setDate('start', v)} />
                        <DateField label="경험기간(종료일)" value={e.dates.end ?? null} onChange={(v) => setDate('end', v)} />
                      </Stack>
                      <TextField
                        label="담당업무"
                        multiline
                        minRows={3}
                        value={e.row.desc}
                        inputProps={{ maxLength: 500 }}
                        helperText={`${e.row.desc.length} / 500자`}
                        onChange={(ev) => set('desc', ev.target.value)}
                      />
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

        <Dialog open={!!notice} onClose={() => setNotice('')}>
          <DialogContent>{notice}</DialogContent>
          <DialogActions>
            <Button onClick={() => setNotice('')}>확인</Button>
          </DialogActions>
        </Dialog>
      </nav>
    </LocalizationProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
