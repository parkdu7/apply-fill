// careerlink 지원서를 흉내 낸 테스트 페이지. 실제 사이트와 같은 MUI v5 + MUI X DatePicker v6.
// 모든 칸이 React 제어 컴포넌트라서 DOM value만 바꾸면 상태에 반영되지 않는다.
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/ko';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

const SCHOOLS = ['서울대학교', '연세대학교', '한국대학교', '한양대학교', '서울시립대학교', '부산대학교'];

interface EduRow {
  school: string | null;
  major: string;
  gradType: string;
  end: Dayjs | null;
  gpa: string;
}

const emptyRow = (): EduRow => ({ school: null, major: '', gradType: '', end: null, gpa: '' });

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function App() {
  const [form, setForm] = useState({
    name: '',
    nameEnLast: '',
    nameEnFirst: '',
    birth: null as Dayjs | null,
    gender: '',
    phone: '',
    email: '',
    military: '',
    hasCareer: false,
    essay: '',
    agree: false,
  });
  const [edu, setEdu] = useState<EduRow[]>([emptyRow()]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(0);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = <K extends keyof EduRow>(i: number, k: K, v: EduRow[K]) =>
    setEdu((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  // 테스트에서 실제 React 상태를 확인하는 창구
  (window as unknown as { __fixtureState: unknown }).__fixtureState = {
    form: { ...form, birth: form.birth?.isValid() ? form.birth.format('YYYY-MM-DD') : null },
    edu: edu.map((r) => ({ ...r, end: r.end?.isValid() ? r.end.format('YYYY-MM') : null })),
    submitted,
    saved,
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ko">
      <Box p={3} maxWidth={960}>
        <Typography variant="h4">2026년 테스트저축은행 신입직원 공개채용 지원서</Typography>

        <Typography variant="h5" mt={3}>
          기본정보
        </Typography>
        <Stack direction="row" spacing={2} mt={2}>
          <TextField label="성명" required value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label="영문 성" value={form.nameEnLast} onChange={(e) => set('nameEnLast', e.target.value)} inputProps={{ maxLength: 30 }} />
          <TextField label="영문 이름" value={form.nameEnFirst} onChange={(e) => set('nameEnFirst', e.target.value)} />
        </Stack>
        <Stack direction="row" spacing={2} mt={2} alignItems="center">
          <DatePicker label="생년월일" format="YYYY.MM.DD" value={form.birth} onChange={(v) => set('birth', v)} maxDate={dayjs()} />
          <FormControl>
            <FormLabel id="gender-label">성별</FormLabel>
            <RadioGroup row aria-labelledby="gender-label" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              <FormControlLabel value="M" control={<Radio />} label="남" />
              <FormControlLabel value="F" control={<Radio />} label="여" />
            </RadioGroup>
          </FormControl>
        </Stack>
        <Stack direction="row" spacing={2} mt={2}>
          <TextField
            label="휴대폰 번호"
            placeholder="010-0000-0000"
            value={form.phone}
            onChange={(e) => set('phone', formatPhone(e.target.value))}
            helperText="숫자만 입력해 주세요."
          />
          <TextField label="이메일" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Stack>

        <Typography variant="h5" mt={3}>
          병역사항
        </Typography>
        <FormControl sx={{ minWidth: 200, mt: 2 }} required>
          <InputLabel id="mil-label">병역구분</InputLabel>
          <Select labelId="mil-label" label="병역구분" value={form.military} onChange={(e) => set('military', e.target.value)}>
            <MenuItem value="">
              <em>선택</em>
            </MenuItem>
            <MenuItem value="01">군필</MenuItem>
            <MenuItem value="02">미필</MenuItem>
            <MenuItem value="03">면제</MenuItem>
            <MenuItem value="04">해당없음</MenuItem>
          </Select>
        </FormControl>

        <Typography variant="h5" mt={3}>
          학력사항
        </Typography>
        {edu.map((row, i) => (
          <Stack key={i} direction="row" spacing={2} mt={2} className="edu-row">
            <Autocomplete
              options={SCHOOLS}
              value={row.school}
              onChange={(_, v) => setRow(i, 'school', v)}
              sx={{ width: 220 }}
              renderInput={(p) => <TextField {...p} label="학교명" />}
            />
            <TextField label="전공" value={row.major} onChange={(e) => setRow(i, 'major', e.target.value)} />
            <FormControl sx={{ minWidth: 140 }}>
              <InputLabel id={`grad-${i}`}>졸업구분</InputLabel>
              <Select labelId={`grad-${i}`} label="졸업구분" value={row.gradType} onChange={(e) => setRow(i, 'gradType', e.target.value)}>
                <MenuItem value="졸업">졸업</MenuItem>
                <MenuItem value="졸업예정">졸업예정</MenuItem>
                <MenuItem value="재학">재학</MenuItem>
                <MenuItem value="중퇴">중퇴</MenuItem>
              </Select>
            </FormControl>
            {row.gradType && (
              <DatePicker label="졸업(예정)일" format="YYYY.MM" views={['year', 'month']} value={row.end} onChange={(v) => setRow(i, 'end', v)} />
            )}
            <TextField label="학점" value={row.gpa} onChange={(e) => setRow(i, 'gpa', e.target.value)} sx={{ width: 100 }} />
          </Stack>
        ))}
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => setEdu((rows) => [...rows, emptyRow()])}>
          + 학력 추가
        </Button>

        <Typography variant="h5" mt={3}>
          경력사항
        </Typography>
        <FormControlLabel control={<Checkbox checked={form.hasCareer} onChange={(e) => set('hasCareer', e.target.checked)} />} label="경력 있음" />

        <Typography variant="h5" mt={3}>
          자기소개서
        </Typography>
        <Typography mt={1}>1. 우리 회사에 지원한 동기를 기술해 주세요.</Typography>
        <TextField
          multiline
          minRows={4}
          fullWidth
          value={form.essay}
          onChange={(e) => set('essay', e.target.value)}
          helperText={`${form.essay.length} / 1000자`}
          inputProps={{ maxLength: 1000 }}
        />
        <FormControlLabel
          control={<Checkbox checked={form.agree} onChange={(e) => set('agree', e.target.checked)} />}
          label="위 내용을 모두 확인하였으며 이에 동의합니다."
        />

        <Stack direction="row" spacing={1} mt={3}>
          <Button variant="outlined" onClick={() => setSaved((s) => s + 1)}>
            임시저장
          </Button>
          <Button variant="outlined">미리보기</Button>
          <Button variant="contained" onClick={() => setConfirmOpen(true)}>
            최종제출
          </Button>
        </Stack>

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <DialogTitle>지원서 제출</DialogTitle>
          <DialogContent>정말 제출하시겠습니까?</DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>취소</Button>
            <Button
              onClick={() => {
                setSubmitted(true);
                setConfirmOpen(false);
              }}
            >
              확인
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </LocalizationProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
