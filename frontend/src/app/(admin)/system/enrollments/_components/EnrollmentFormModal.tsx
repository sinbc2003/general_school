"use client";

/**
 * 학기 명단 추가/수정 모달.
 *
 * - 신규 등록: UserSearchInput으로 기존 사용자 검색 → 역할/학년/반 자동 채움
 * - 수정: user_id 변경 불가 (학기 + user_id 복합키)
 * - role 분기: student vs teacher/staff로 form 항목 다름
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { UserSearchInput } from "@/components/admin/UserSearchInput";
import type { Enrollment } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  active: "재학/재직",
  transferred: "전출",
  graduated: "졸업",
  on_leave: "휴학/휴직",
};

interface FormData {
  user_id: number | "";
  role: string;
  status: string;
  grade: number | "";
  class_number: number | "";
  student_number: number | "";
  department: string;
  position: string;
  homeroom_class: string;
  subhomeroom_class: string;
  teaching_grades: string;
  teaching_classes: string;
  teaching_subjects: string;
  note: string;
}

const EMPTY_FORM: FormData = {
  user_id: "",
  role: "student",
  status: "active",
  grade: "",
  class_number: "",
  student_number: "",
  department: "",
  position: "",
  homeroom_class: "",
  subhomeroom_class: "",
  teaching_grades: "",
  teaching_classes: "",
  teaching_subjects: "",
  note: "",
};

interface Props {
  open: boolean;
  editingId: number | null;
  editingEnrollment: Enrollment | null;
  semesterId: number | null;
  existingUserIds: number[];  // user select 시 제외
  onClose: () => void;
  onSaved: () => void;
}

export function EnrollmentFormModal({
  open,
  editingId,
  editingEnrollment,
  semesterId,
  existingUserIds,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingId && editingEnrollment) {
      const e = editingEnrollment;
      setForm({
        user_id: e.user_id,
        role: e.role,
        status: e.status,
        grade: e.grade ?? "",
        class_number: e.class_number ?? "",
        student_number: e.student_number ?? "",
        department: e.department ?? "",
        position: e.position ?? "",
        homeroom_class: e.homeroom_class ?? "",
        subhomeroom_class: e.subhomeroom_class ?? "",
        teaching_grades: (e.teaching_grades || []).join(","),
        teaching_classes: (e.teaching_classes || []).join(","),
        teaching_subjects: (e.teaching_subjects || []).join(","),
        note: e.note ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingId, editingEnrollment]);

  const update = (k: keyof FormData, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!semesterId) return;
    if (!editingId && !form.user_id) {
      alert("등록할 사용자 ID를 입력하세요");
      return;
    }
    setSubmitting(true);
    try {
      const body: any = {
        role: form.role,
        status: form.status,
        grade: form.grade === "" ? null : form.grade,
        class_number: form.class_number === "" ? null : form.class_number,
        student_number: form.student_number === "" ? null : form.student_number,
        department: form.department || null,
        position: form.position || null,
        homeroom_class: form.homeroom_class || null,
        subhomeroom_class: form.subhomeroom_class || null,
        teaching_grades: form.teaching_grades || null,
        teaching_classes: form.teaching_classes || null,
        teaching_subjects: form.teaching_subjects || null,
        note: form.note || null,
      };
      if (editingId) {
        await api.put(`/api/timetable/semesters/${semesterId}/enrollments/${editingId}`, body);
      } else {
        body.user_id = form.user_id;
        await api.post(`/api/timetable/semesters/${semesterId}/enrollments`, body);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingId ? "명단 수정" : "명단 추가"}
      maxWidth="xl"
    >
      <div className="grid grid-cols-2 gap-3">
        {!editingId && (
          <div className="col-span-2">
            <label className="block text-caption text-text-secondary mb-1">사용자 *</label>
            <UserSearchInput
              value={form.user_id}
              onSelect={(u) => {
                if (u) {
                  // 사용자가 학생/교사 등 본인 역할 가지면 form.role도 자동 맞춤
                  update("user_id", u.id);
                  if (["student", "teacher", "staff"].includes(u.role)) {
                    update("role", u.role);
                  }
                  // 학생이면 학년/반 자동 채움 (수정 가능)
                  if (u.role === "student") {
                    if (u.grade != null) update("grade", u.grade);
                    if (u.class_number != null) update("class_number", u.class_number);
                  }
                } else {
                  update("user_id", "");
                }
              }}
              excludeUserIds={new Set(existingUserIds)}
              placeholder="이름 또는 이메일로 검색..."
              autoFocus
            />
          </div>
        )}
        <div>
          <label className="block text-caption text-text-secondary mb-1">역할 *</label>
          <select
            value={form.role}
            onChange={(e) => update("role", e.target.value)}
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          >
            <option value="student">학생</option>
            <option value="teacher">교사</option>
            <option value="staff">직원</option>
          </select>
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">상태</label>
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {form.role === "student" ? (
          <>
            <div>
              <label className="block text-caption text-text-secondary mb-1">학년</label>
              <input
                type="number"
                value={form.grade}
                onChange={(e) => update("grade", e.target.value === "" ? "" : parseInt(e.target.value))}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">반</label>
              <input
                type="number"
                value={form.class_number}
                onChange={(e) => update("class_number", e.target.value === "" ? "" : parseInt(e.target.value))}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-caption text-text-secondary mb-1">번호</label>
              <input
                type="number"
                value={form.student_number}
                onChange={(e) => update("student_number", e.target.value === "" ? "" : parseInt(e.target.value))}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-caption text-text-secondary mb-1">부서</label>
              <input
                type="text"
                value={form.department}
                onChange={(e) => update("department", e.target.value)}
                placeholder="예: 수학과"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">직위</label>
              <input
                type="text"
                value={form.position}
                onChange={(e) => update("position", e.target.value)}
                placeholder="예: 부장, 평교사"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">담임반</label>
              <input
                type="text"
                value={form.homeroom_class}
                onChange={(e) => update("homeroom_class", e.target.value)}
                placeholder="예: 3-2"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">부담임반</label>
              <input
                type="text"
                value={form.subhomeroom_class}
                onChange={(e) => update("subhomeroom_class", e.target.value)}
                placeholder="예: 3-3"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">수업 학년</label>
              <input
                type="text"
                value={form.teaching_grades}
                onChange={(e) => update("teaching_grades", e.target.value)}
                placeholder="콤마 구분, 예: 1,2,3"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">수업 학급</label>
              <input
                type="text"
                value={form.teaching_classes}
                onChange={(e) => update("teaching_classes", e.target.value)}
                placeholder="예: 1-1,1-2,2-3 (학년만 작성하면 생략)"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-caption text-text-secondary mb-1">가르치는 과목</label>
              <input
                type="text"
                value={form.teaching_subjects}
                onChange={(e) => update("teaching_subjects", e.target.value)}
                placeholder="콤마 구분, 예: 수학,수학I"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          </>
        )}
        <div className="col-span-2">
          <label className="block text-caption text-text-secondary mb-1">비고</label>
          <input
            type="text"
            value={form.note}
            onChange={(e) => update("note", e.target.value)}
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          />
        </div>
      </div>
      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          취소
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? "저장 중..." : editingId ? "수정" : "추가"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
