// 강좌 상세 페이지 공유 타입.
export interface Student {
  id: number;
  student_id: number;
  name: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  joined_at: string | null;
}

export interface Attachment {
  type: "link" | "file" | "doc" | "survey" | "sheet" | "deck" | "hwp" | "chatbot";
  title: string;
  url?: string;
  file_url?: string;
  file_name?: string;
  doc_id?: number;
  survey_id?: number;
  sheet_id?: number;
  deck_id?: number;
  hwp_id?: number;
  chatbot_id?: number;
  /** 파일 공유 옵션 (doc/sheet/deck/hwp) — view | edit | copy */
  share_mode?: "view" | "edit" | "copy";
}

export interface Post {
  id: number;
  course_id: number;
  author_id: number | null;
  author_name?: string;
  post_type: string;
  title: string;
  content: string;
  is_pinned: boolean;
  due_date: string | null;
  max_score: number | null;
  topic: string | null;
  attachments: Attachment[];
  created_at: string | null;
  /** 과제 글만 — turned_in + returned 제출 수 (목록 API가 계산) */
  turned_in_count?: number;
}

export interface CourseDetail {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  description: string | null;
  is_active: boolean;
  teacher_name?: string;
  student_count: number;
  students: Student[];
  viewer_role: "admin" | "teacher" | "student";
  is_past_semester?: boolean;
  semester?: { name: string; year: number; term: number } | null;
}
