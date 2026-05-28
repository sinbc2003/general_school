"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/api/client";

interface SemesterLite { id: number; name: string; is_current: boolean }

export function CreateGroupModal({
  semesters, onClose, onCreated,
}: {
  semesters: SemesterLite[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const current = semesters.find((s) => s.is_current) || semesters[0];
  const [form, setForm] = useState({
    semester_id: current?.id || 0,
    name: "",
    type: "event",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const create = async () => {
    if (!form.name.trim() || !form.semester_id) { alert("학기·이름 필수"); return; }
    setSubmitting(true);
    try {
      await api.post("/api/teacher-groups", form);
      onCreated();
    } catch (e: any) {
      alert(`생성 실패: ${e?.detail || e}`);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg p-5 w-full max-w-md">
        <h3 className="text-body font-semibold text-text-primary mb-3">새 그룹 만들기</h3>
        <p className="text-caption text-amber-600 mb-3 inline-flex items-center gap-1">
          <AlertCircle size={12} /> 부장 교사만 생성 가능 (admin은 항상 가능)
        </p>

        <label className="block mb-2">
          <span className="text-caption text-text-tertiary">학기</span>
          <select value={form.semester_id} onChange={(e) => setForm({ ...form, semester_id: parseInt(e.target.value) })}
                  className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
            {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " (현재)" : ""}</option>)}
          </select>
        </label>

        <label className="block mb-2">
          <span className="text-caption text-text-tertiary">그룹명 *</span>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                 placeholder="예: 2026 수학경시대회"
                 className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary" />
        </label>

        <label className="block mb-2">
          <span className="text-caption text-text-tertiary">유형</span>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
            <option value="event">행사</option>
            <option value="contest">대회</option>
            <option value="research">연구</option>
            <option value="etc">기타</option>
          </select>
        </label>

        <label className="block mb-3">
          <span className="text-caption text-text-tertiary">설명</span>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-caption bg-bg-primary" />
        </label>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 text-caption text-text-secondary">취소</button>
          <button onClick={create} disabled={submitting || !form.name.trim()}
                  className="px-4 py-1.5 bg-accent text-white text-caption rounded disabled:opacity-50">
            {submitting ? "생성 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
