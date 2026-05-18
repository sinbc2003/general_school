"use client";

/**
 * 학교 구조 설정 모달 — 학년별 학급 수, 개설 과목, 부서 목록.
 *
 * 교사가 첫 로그인 시 본인 담당 학년/학급/과목을 입력할 때 사용할 드롭다운 옵션 정의.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { School, X } from "lucide-react";
import { ChipInput } from "@/components/ui/ChipInput";
import type { Semester } from "@/types";

interface StructureForm {
  classes_per_grade: Record<string, number>;
  subjects: string[];
  departments: string[];
}

interface Props {
  semester: Semester | null;  // null이면 닫혀있음
  onClose: () => void;
  onSaved: () => void;
}

export function SchoolStructureModal({ semester, onClose, onSaved }: Props) {
  const [form, setForm] = useState<StructureForm>({
    classes_per_grade: { "1": 0, "2": 0, "3": 0 },
    subjects: [],
    departments: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (semester) {
      setForm({
        classes_per_grade: { "1": 0, "2": 0, "3": 0, ...(semester.classes_per_grade || {}) },
        subjects: semester.subjects || [],
        departments: semester.departments || [],
      });
    }
  }, [semester]);

  if (!semester) return null;

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/timetable/semesters/${semester.id}/structure`, {
        classes_per_grade: form.classes_per_grade,
        subjects: form.subjects,
        departments: form.departments,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body font-medium text-text-primary flex items-center gap-2">
            <School size={18} /> 학교 구조 설정
          </h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={16} />
          </button>
        </div>
        <p className="text-caption text-text-tertiary mb-4">
          교사가 첫 로그인 시 본인의 담당 학년/학급/과목을 입력할 때 사용할 <b>드롭다운 목록</b>을 정의합니다.
          표준화된 데이터로 수집되어 "담당 학생만 조회" 같은 정책이 정확히 작동합니다.
        </p>

        <section className="mb-5">
          <h3 className="text-body font-medium text-text-primary mb-2">학년별 학급 수</h3>
          <div className="grid grid-cols-3 gap-3">
            {(["1", "2", "3"] as const).map((g) => (
              <div key={g}>
                <label className="block text-caption text-text-secondary mb-1">{g}학년</label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={form.classes_per_grade[g] ?? 0}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      classes_per_grade: { ...p.classes_per_grade, [g]: parseInt(e.target.value || "0") },
                    }))
                  }
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                />
              </div>
            ))}
          </div>
          <p className="text-caption text-text-tertiary mt-1">
            예: 1학년 5개 반이면 5 입력 → 드롭다운에 "1-1, 1-2, ..., 1-5" 자동 생성.
          </p>
        </section>

        <section className="mb-5">
          <h3 className="text-body font-medium text-text-primary mb-2">개설 과목</h3>
          <ChipInput
            items={form.subjects}
            onChange={(items) => setForm((p) => ({ ...p, subjects: items }))}
            placeholder="과목명 입력 후 Enter (예: 수학) — 콤마/줄바꿈 붙여넣기도 가능"
          />
          <p className="text-caption text-text-tertiary mt-1">
            {form.subjects.length}개 과목 · Enter 추가 · Backspace로 마지막 삭제
          </p>
        </section>

        <section className="mb-5">
          <h3 className="text-body font-medium text-text-primary mb-2">부서 목록</h3>
          <ChipInput
            items={form.departments}
            onChange={(items) => setForm((p) => ({ ...p, departments: items }))}
            placeholder="부서명 입력 후 Enter (예: 수학과)"
          />
          <p className="text-caption text-text-tertiary mt-1">
            {form.departments.length}개 부서
          </p>
        </section>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
