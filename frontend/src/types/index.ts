/**
 * 프로젝트 전역 공유 타입 — 백엔드 모델과 1:1 대응.
 *
 * 각 페이지에서 동일 인터페이스를 중복 선언하지 말고 여기서 import.
 * 백엔드 schema 변경 시 여기 한 군데만 업데이트하면 됨.
 */

/** 사용자 역할 */
export type Role = "super_admin" | "designated_admin" | "teacher" | "staff" | "student";

/** 사용자 상태 */
export type UserStatus = "pending" | "approved" | "rejected" | "graduated" | "on_leave" | "transferred";

/** 학기 — `system_semesters` 테이블.
 *
 * 백엔드는 항상 모든 필드를 반환하므로 optional 표시는 클라이언트 ergonomics 용도가 아니라
 * 실제 nullable인 경우만 (archived_at 등) 적용.
 */
export interface Semester {
  id: number;
  year: number;
  semester: number;
  name: string;
  is_current: boolean;
  start_date: string;
  end_date: string;
  is_archived?: boolean;
  archived_at?: string | null;
  // 학교 구조 — 인라인 드롭다운 옵션 생성용 (페이지마다 부분만 사용)
  classes_per_grade?: Record<string, number>;
  subjects?: string[];
  departments?: string[];
}

/** 사용자 항목 — `/api/users` 응답 */
export interface UserItem {
  id: number;
  email: string;
  name: string;
  username: string | null;
  role: string;
  status: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  department: string | null;
  created_at: string | null;
}

/** 로그인된 사용자 정보 — `/api/auth/me` 응답 */
export interface UserInfo {
  id: number;
  username: string | null;
  email: string;
  name: string;
  role: string;
  status: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  department: string | null;
  totp_enabled: boolean;
  must_change_password: boolean;
  // admin 2FA 강제 정책 ON + admin role + 2FA 미등록이면 True
  must_enable_2fa?: boolean;
  permissions: string[];
}

/** 학기 단위 명부(enrollment) — `enrollments` 테이블 */
export interface Enrollment {
  id: number;
  semester_id: number;
  user_id: number;
  role: string;
  status: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  department: string | null;
  position: string | null;
  homeroom_class: string | null;
  subhomeroom_class: string | null;
  teaching_grades: (number | string)[];
  teaching_classes: string[];
  teaching_subjects: string[];
  note: string | null;
  position_count?: number;
  user: {
    id: number;
    username: string | null;
    email: string;
    name: string;
  } | null;
}

/** 권한 키 카탈로그 항목 */
export interface PermissionDef {
  key: string;
  display_name: string;
  category: string;
  description?: string;
  requires_2fa?: boolean;
  is_sensitive?: boolean;
}
