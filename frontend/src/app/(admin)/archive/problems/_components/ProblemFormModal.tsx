"use client";

/**
 * 문제 등록/수정 모달.
 *
 * 신규 등록 + 기존 문제 수정 동일 form. content만 필수.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api/client";
import type { ProblemFormData, ProblemItem } from "../_shared";
import {
  DIFFICULTY_LABELS, EMPTY_FORM, QUESTION_TYPE_LABELS, SUBJECT_OPTIONS,
} from "../_shared";

interface Props {
  open: boolean;
  editingId: number | null;
  editingProblem: ProblemItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProblemFormModal({ open, editingId, editingProblem, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProblemFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingId && editingProblem) {
      setForm({
        subject: editingProblem.subject,
        difficulty: editingProblem.difficulty,
        question_type: editingProblem.question_type,
        content: editingProblem.content,
        solution: "",
        answer: "",
        grade_semester: "",
        year: editingProblem.year ? String(editingProblem.year) : "",
        tags: editingProblem.tags?.join(", ") || "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingId, editingProblem]);

  if (!open) return null;

  const updateForm = (key: keyof ProblemFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    if (!form.content.trim()) {
      alert("문제 내용을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        subject: form.subject,
        difficulty: form.difficulty,
        question_type: form.question_type,
        content: form.content.trim(),
        solution: form.solution.trim() || null,
        answer: form.answer.trim() || null,
        grade_semester: form.grade_semester.trim() || null,
        year: form.year ? Number(form.year) : null,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      };

      if (editingId) {
        await api.put(`/api/archive/problems/${editingId}`, body);
        alert("수정 완료");
      } else {
        await api.post("/api/archive/problems", body);
        alert("등록 완료");
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body font-medium text-text-primary">
            {editingId ? "문제 수정" : "문제 등록"}
          </h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-caption text-text-secondary mb-1">과목</label>
            <select
              value={form.subject}
              onChange={(e) => updateForm("subject", e.target.value)}
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">난이도</label>
            <select
              value={form.difficulty}
              onChange={(e) => updateForm("difficulty", e.target.value)}
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">문제 유형</label>
            <select
              value={form.question_type}
              onChange={(e) => updateForm("question_type", e.target.value)}
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">학년/학기</label>
            <input
              type="text"
              value={form.grade_semester}
              onChange={(e) => updateForm("grade_semester", e.target.value)}
              placeholder="예: 1-1, 2-2"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">연도</label>
            <input
              type="number"
              value={form.year}
              onChange={(e) => updateForm("year", e.target.value)}
              placeholder="2024"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">태그 (쉼표 구분)</label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => updateForm("tags", e.target.value)}
              placeholder="미적분, 함수, 극한"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-caption text-text-secondary mb-1">문제 내용 *</label>
            <textarea
              value={form.content}
              onChange={(e) => updateForm("content", e.target.value)}
              rows={5}
              placeholder="문제 내용을 입력하세요"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-caption text-text-secondary mb-1">풀이</label>
            <textarea
              value={form.solution}
              onChange={(e) => updateForm("solution", e.target.value)}
              rows={4}
              placeholder="풀이 과정을 입력하세요"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-caption text-text-secondary mb-1">정답</label>
            <input
              type="text"
              value={form.answer}
              onChange={(e) => updateForm("answer", e.target.value)}
              placeholder="정답"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
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
            {submitting ? "저장 중..." : editingId ? "수정" : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
