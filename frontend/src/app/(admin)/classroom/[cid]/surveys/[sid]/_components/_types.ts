/**
 * SurveyBuilder 공유 타입.
 *
 * page.tsx / QuestionCard / AddQuestionModal 등이 같은 정의 공유.
 */

export type QType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multi_choice"
  | "rating"
  | "date";

export interface Question {
  id: number;
  order: number;
  question_text: string;
  question_type: QType;
  is_required: boolean;
  options: string[];
  rating_max: number;
}

export const TYPE_LABELS: Record<QType, string> = {
  short_text: "단답형",
  long_text: "장문형",
  single_choice: "객관식 (한 개)",
  multi_choice: "체크박스 (여러 개)",
  rating: "평점",
  date: "날짜",
};
