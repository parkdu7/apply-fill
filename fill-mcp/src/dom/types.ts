// 페이지 안(content script / Playwright evaluate)과 Node 쪽이 함께 쓰는 타입.

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'tel'
  | 'date'
  | 'month'
  | 'select' // 네이티브 <select>
  | 'listbox' // 커스텀 드롭다운 (MUI Select 등, aria-haspopup=listbox)
  | 'combobox' // 검색형 자동완성 (MUI Autocomplete, 학교·자격증 DB 검색 등)
  | 'radio'
  | 'toggle' // 토글 버튼 묶음 (국내/국외, 신규입학/편입 등 aria-pressed 버튼)
  | 'checkbox' // 네이티브 체크박스 또는 아이콘으로 그린 커스텀 체크
  | 'editable'; // contenteditable

/** 에이전트가 채우지 않고 사람에게 넘기는 이유 */
export type ManualReason =
  | 'file'
  | 'password'
  | 'sensitive'
  | 'essay'
  | 'consent'
  | 'readonly'
  | 'disabled'
  | 'address' // input이 아니라 div로 그린 주소 칸 (주소 검색 팝업으로만 들어간다)
  | 'popup'; // 그 밖에 div로 그린 칸 (검색 팝업 등으로만 들어간다)

export interface Field {
  key: string;
  kind: FieldKind;
  label: string;
  section?: string;
  required?: boolean;
  /** 현재 값. 선택형은 선택된 항목의 텍스트, 체크박스는 'true' | 'false' */
  value?: string;
  options?: string[];
  /** options에서 생략된 개수 */
  moreOptions?: number;
  placeholder?: string;
  maxLength?: number;
  /** 칸 옆 보조 문구 (단위, 도움말, 에러 메시지) */
  hint?: string;
  /** "2/3": 한 항목이 여러 칸으로 나뉜 경우 (휴대폰 010-1234-5678 등) */
  part?: string;
  /** 같은 라벨이 반복되는 행 번호 (1부터) */
  nth?: number;
  filledByAgent?: boolean;
  manual?: ManualReason;
}

/**
 * rowsave: 편집 팝업 안의 "저장하기" (행 확정, 채우기의 일부라 눌러도 된다)
 * save: 지원서 전체 임시저장 (사용자가 원할 때만)
 */
export type ButtonKind = 'next' | 'save' | 'rowsave' | 'add' | 'edit' | 'search' | 'tab' | 'other' | 'blocked';

export interface ActionButton {
  key: string;
  kind: ButtonKind;
  text: string;
  section?: string;
}

/** 카드형 반복 섹션(학력·경력·자격 등): 추가 버튼과 이미 저장된 행 */
export interface CardSection {
  title: string;
  addKey?: string;
  rows: { text: string; editKey?: string }[];
}

export interface PageScan {
  url: string;
  title: string;
  fields: Field[];
  buttons: ActionButton[];
  cards?: CardSection[];
  /** 모달(편집 팝업·안내창)이 열려 있어 그 안만 스캔했는지 */
  modal?: { title: string; text: string; editing: boolean };
}

export interface FillRequest {
  key: string;
  value: string;
  confidence?: 'high' | 'low';
  /** 이미 값이 있는 칸을 덮어쓸지. 사용자가 명시적으로 원할 때만 */
  overwrite?: boolean;
  /** 자동완성 칸에 칠 검색어 (value는 고를 후보). 없으면 value로 검색 */
  query?: string;
  /** 자동완성에 맞는 후보가 없을 때 "직접입력"으로 넣을지 */
  direct?: boolean;
  /** 후보가 여러 개일 때 고르는 단서 (소재지·캠퍼스 등 같은 행의 다른 값). "한국대학교" + ["세종"] → "한국대학교(세종)" */
  prefer?: string[];
}

/** auto: 잠긴 칸이라 직접 넣지 않았고, 사이트가 자동으로 채웠다 (앞 칸을 고르면 채워지는 발행처·취득시기 등) */
export type FillStatus = 'ok' | 'mismatch' | 'skipped' | 'refused' | 'auto' | 'not_found' | 'error';

export interface FillOutcome {
  key: string;
  status: FillStatus;
  kind?: FieldKind;
  label?: string;
  /** 입력 후 실제로 반영된 값 */
  actual?: string;
  message?: string;
  /** 비활성·잠긴 칸이라 넣지 않음 (앞 칸을 고르면 풀리거나 사이트가 채울 수 있어 나중에 다시 본다) */
  locked?: boolean;
}

/** 다시 확인한 칸 상태 (토글이 다른 칸을 비웠는지, 잠긴 칸이 풀렸는지) */
export interface FieldState {
  key: string;
  exists: boolean;
  disabled: boolean;
  value: string;
  /** verify에서 기대값과 아직 맞는지 */
  ok?: boolean;
}

export interface ButtonInfo {
  key: string;
  kind: ButtonKind;
  text: string;
  disabled?: boolean;
}

export interface ModalState {
  open: boolean;
  title: string;
  /** 팝업 안에 보이는 오류/안내 문구 ("필수 항목을 입력해 주세요" 등) */
  errors?: string[];
}

/** 확장 드라이버의 합성 키 입력 동작 (src/transport.ts KeyAction과 같은 값) */
export type KeyActionName = 'selectAll' | 'backspace' | 'tab';
