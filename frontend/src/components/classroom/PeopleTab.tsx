"use client";

/**
 * 강좌 수강 학생 명단 탭 — admin / student 양쪽 공유.
 *
 * - canEdit=true: 학생 등록(onAdd) + 제외(onRemove) 버튼 표시
 * - canEdit=false: 명단 view-only (학생 페이지에서 같이 듣는 친구들 확인용)
 *
 * 헤더 라벨:
 *   - admin: "수강 학생 (N)"
 *   - student: "함께하는 학생 (N)"
 */

import { Users, UserPlus, Trash2 } from "lucide-react";

interface StudentRow {
  id: number;
  student_id: number;
  name: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
}

interface Props {
  students: StudentRow[];
  teacherName?: string | null;
  canEdit: boolean;
  onAdd?: () => void;
  onRemove?: (studentId: number, name: string) => void;
  /** 헤더 라벨 분기 — admin/student */
  variant?: "admin" | "student";
}

export function PeopleTab({
  students, teacherName, canEdit, onAdd, onRemove,
  variant = "admin",
}: Props) {
  const headerLabel = variant === "student" ? "함께하는 학생" : "수강 학생";
  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-body font-semibold flex items-center gap-1">
          <Users size={15} /> {headerLabel} ({students.length})
        </h2>
        {canEdit && onAdd && (
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
          >
            <UserPlus size={12} /> 학생 등록
          </button>
        )}
      </div>
      {teacherName && (
        <div className="text-caption text-text-tertiary mb-3 px-2 py-1.5 bg-bg-secondary rounded">
          담당 교사: <span className="text-text-primary font-medium">{teacherName}</span>
        </div>
      )}
      {students.length === 0 ? (
        <div className="text-caption text-text-tertiary py-8 text-center">
          {variant === "student" ? "등록된 학생 정보 없음" : "등록된 학생 없음"}
        </div>
      ) : (
        <div className="divide-y divide-border-default">
          {students.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between px-2 py-2 hover:bg-bg-secondary rounded group text-caption"
            >
              <div>
                <span className="font-medium text-text-primary">{s.name}</span>
                <span className="text-text-tertiary ml-2">
                  {s.grade && s.class_number && s.student_number
                    ? `${s.grade}${String(s.class_number).padStart(2, "0")}${String(s.student_number).padStart(2, "0")}`
                    : ""}
                </span>
              </div>
              {canEdit && onRemove && (
                <button
                  onClick={() => onRemove(s.student_id, s.name)}
                  className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-error"
                  title="제외"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
