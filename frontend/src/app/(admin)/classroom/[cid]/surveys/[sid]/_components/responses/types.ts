// ResponsesTab 공유 타입
export type QType = "short_text" | "long_text" | "single_choice" | "multi_choice" | "rating" | "date";

export interface QuestionSummary {
  id: number;
  order: number;
  question_text: string;
  question_type: QType;
  is_required: boolean;
  options: string[];
  rating_max: number;
  response_count: number;
  choice_counts?: Record<string, number>;
  rating_counts?: Record<string, number>;
  rating_avg?: number | null;
  text_values?: string[];
}

export interface ResponseRow {
  id: number;
  respondent_id: number | null;
  respondent_name: string | null;
  submitted_at: string | null;
  answers: Array<{
    question_id: number;
    text_value: string | null;
    choice_values: string[] | null;
    rating_value: number | null;
  }>;
}

export interface ResultData {
  survey: {
    id: number;
    title: string;
    is_anonymous: boolean;
    status: string;
  };
  response_count: number;
  questions: QuestionSummary[];
  responses: ResponseRow[];
}
