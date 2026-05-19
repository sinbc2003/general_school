/**
 * 문제 검색 페이지 공유 타입 + 상수.
 */

export interface ProblemItem {
  id: number;
  subject: string;
  difficulty: string;
  question_type: string;
  year: number | null;
  content: string;
  tags: string[];
  review_status: string;
  created_at: string;
}

export interface ProblemListResponse {
  items: ProblemItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ProblemFormData {
  subject: string;
  difficulty: string;
  question_type: string;
  content: string;
  solution: string;
  answer: string;
  grade_semester: string;
  year: string;
  tags: string;
}

export const EMPTY_FORM: ProblemFormData = {
  subject: "수학",
  difficulty: "medium",
  question_type: "multiple_choice",
  content: "",
  solution: "",
  answer: "",
  grade_semester: "",
  year: String(new Date().getFullYear()),
  tags: "",
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "하",
  medium: "중",
  hard: "상",
  very_hard: "최상",
};

export const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  hard: "bg-orange-100 text-orange-700",
  very_hard: "bg-red-100 text-red-700",
};

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "단답형",
  essay: "서술형",
  proof: "증명",
};

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "검토 대기",
  approved: "승인",
  rejected: "반려",
};

export const SUBJECT_OPTIONS = [
  "수학", "국어", "영어", "과학", "사회", "역사", "도덕",
  "물리", "화학", "생물", "지구과학", "기타",
];

export function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR");
}
