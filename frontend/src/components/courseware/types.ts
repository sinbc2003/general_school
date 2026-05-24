/**
 * 문제은행 코스웨어 공통 타입.
 *
 * Backend Pydantic schemas (backend/app/modules/courseware/schemas.py)와 1:1.
 */

export type ProblemType = "multiple_choice" | "short_answer" | "numeric" | "essay" | "code";
export type GraderType = "choices" | "exact" | "regex" | "numeric" | "essay" | "manual" | "llm";
export type ProblemSetStatus = "draft" | "published" | "closed";

export interface ProblemInline {
  type: ProblemType;
  content: string;
  solution?: string | null;
  answer?: string | null;
  answer_data?: Record<string, any> | null;
  difficulty?: "easy" | "medium" | "hard" | "olympiad";
  subject?: string | null;
  tags?: string[] | null;
}

export interface ProblemSetSummary {
  id: number;
  course_id: number;
  title: string;
  description: string | null;
  problem_count: number;
  status: ProblemSetStatus;
  due_date: string | null;
  time_limit_seconds: number | null;
  max_attempts: number;
  show_solution_after_due: boolean;
  settings: Record<string, any>;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProblemFull {
  id: number;
  type: string;
  content: string;
  solution: string | null;
  answer: string | null;
  answer_data: Record<string, any> | null;
  difficulty: string;
  subject: string | null;
  tags: string[];
}

export interface ProblemForStudent {
  id: number;
  type: string;
  content: string;
  difficulty: string;
  subject: string | null;
  tags: string[];
  choices?: string[];
  solution?: string;
  answer?: string;
  answer_data?: Record<string, any>;
}

export interface ProblemSetDetail extends ProblemSetSummary {
  problems: ProblemFull[];
}

export interface StudentViewResp extends ProblemSetSummary {
  problems: ProblemForStudent[];
  is_past_due: boolean;
  solution_revealed: boolean;
  attempts_used: number;
  attempts_left: number;
}

export interface SubmitResult {
  ok: boolean;
  attempt_number: number;
  total_problems: number;
  auto_graded: number;
  auto_correct: number;
  auto_score_sum: number;
  manual_pending: number;
  llm_pending?: number;
  llm_grading_started?: boolean;
  results: {
    problem_id: number;
    is_correct: boolean | null;
    auto_score: number;
    has_manual_pending: boolean;
    llm_grading?: boolean;
  }[];
}

export type GradingStatus = "none" | "pending" | "running" | "done" | "failed";

export interface LLMMetadata {
  provider?: string;
  model?: string;
  model_label?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  raw_response?: string;
  graded_at?: string;
  error?: string;
}

export interface MyAttemptRow {
  attempt_number: number;
  problem_id: number;
  answer_data: Record<string, any> | null;
  is_correct: boolean | null;
  auto_score: number | null;
  manual_score: number | null;
  manual_feedback: string | null;
  grading_status: GradingStatus;
  llm_metadata: LLMMetadata | null;
  submitted_at: string | null;
  graded_at: string | null;
}

export interface ResultsResp {
  students: {
    student_id: number;
    name: string;
    attempts_count: number;
    best_score: number;
    latest_attempt_at: string | null;
  }[];
  problems: {
    problem_id: number;
    total_submissions: number;
    correct_count: number;
    accuracy: number;
  }[];
}

export interface BankSearchItem {
  id: number;
  subject: string;
  difficulty: string;
  question_type: string;
  content_preview: string;
  answer: string | null;
  answer_data: Record<string, any> | null;
  grader_type: string | null;
  tags: string[];
  created_at: string | null;
}

export const DIFFICULTY_OPTIONS: { value: "easy" | "medium" | "hard" | "olympiad"; label: string }[] = [
  { value: "easy", label: "쉬움" },
  { value: "medium", label: "보통" },
  { value: "hard", label: "어려움" },
  { value: "olympiad", label: "올림피아드" },
];

export const TYPE_OPTIONS: { value: ProblemType; label: string; grader: GraderType }[] = [
  { value: "multiple_choice", label: "객관식", grader: "choices" },
  { value: "short_answer", label: "단답형", grader: "exact" },
  { value: "numeric", label: "수치", grader: "numeric" },
  { value: "essay", label: "서술형", grader: "essay" },
];

export const STATUS_LABEL: Record<ProblemSetStatus, string> = {
  draft: "초안",
  published: "게시 중",
  closed: "마감",
};

export const STATUS_BADGE_TONE: Record<ProblemSetStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  published: "bg-emerald-100 text-emerald-700",
  closed: "bg-amber-100 text-amber-700",
};
