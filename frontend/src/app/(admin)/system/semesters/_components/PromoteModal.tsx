"use client";

/**
 * 진급/명단 복제 마법사 — 이전 학기의 학생·교직원 명단을 다음 학기로 복제.
 *
 * - 학생: 학년 +1 (졸업 학년은 자동 졸업 처리)
 * - 교직원: 명단 그대로 (담임반 미배정)
 * - 항상 미리보기(dry-run) 먼저 → 결과 확인 후 실제 반영
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { AlertCircle, ArrowRight, X } from "lucide-react";
import type { Semester } from "@/types";

interface Props {
  open: boolean;
  items: Semester[];
  onClose: () => void;
  onPromoted: () => void;
}

interface PromotePreview {
  dry_run: boolean;
  promoted: number;
  graduated: number;
  copied_teachers: number;
  skipped: number;
  plan_preview?: any[];
}

export function PromoteModal({ open, items, onClose, onPromoted }: Props) {
  const [fromSid, setFromSid] = useState<number | null>(null);
  const [toSid, setToSid] = useState<number | null>(null);
  const [graduateGrade, setGraduateGrade] = useState<number | "">(3);
  const [copyTeachers, setCopyTeachers] = useState(true);
  const [promoteStudents, setPromoteStudents] = useState(true);
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [running, setRunning] = useState(false);

  // 모달 열릴 때 디폴트 학기 자동 선택 (최신 2개)
  useEffect(() => {
    if (open) {
      setPreview(null);
      if (items.length >= 2) {
        setFromSid(items[1].id);
        setToSid(items[0].id);
      }
    }
  }, [open, items]);

  if (!open) return null;

  const run = async (dryRun: boolean) => {
    if (!fromSid || !toSid) {
      alert("이전 학기와 대상 학기를 선택하세요");
      return;
    }
    if (fromSid === toSid) {
      alert("같은 학기는 선택할 수 없습니다");
      return;
    }
    setRunning(true);
    try {
      const data = await api.post<PromotePreview>(
        `/api/timetable/semesters/${fromSid}/promote-to/${toSid}`,
        {
          dry_run: dryRun,
          promote_students: promoteStudents,
          copy_teachers: copyTeachers,
          graduate_grade: graduateGrade === "" ? null : graduateGrade,
        },
      );
      setPreview(data);
      if (!dryRun) {
        alert(
          `반영 완료: 진급 ${data.promoted}, 졸업 ${data.graduated}, 교직원 복제 ${data.copied_teachers}, 스킵 ${data.skipped}`,
        );
        onPromoted();
        onClose();
      }
    } catch (err: any) {
      alert(err?.detail || "처리 실패");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body font-medium text-text-primary flex items-center gap-2">
            <ArrowRight size={18} /> 진급/명단 복제
          </h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={16} />
          </button>
        </div>
        <p className="text-caption text-text-secondary mb-4">
          이전 학기의 학생/교직원 명단을 대상 학기로 복제합니다. 학생은 학년이 +1 되고, 졸업 학년은 자동으로 졸업 처리됩니다.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-caption text-text-secondary mb-1">이전 학기 *</label>
            <select
              value={fromSid ?? ""}
              onChange={(e) => setFromSid(parseInt(e.target.value))}
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              <option value="">선택</option>
              {items.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">대상 학기 *</label>
            <select
              value={toSid ?? ""}
              onChange={(e) => setToSid(parseInt(e.target.value))}
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              <option value="">선택</option>
              {items.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 space-y-2 mt-2">
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={promoteStudents}
                onChange={(e) => setPromoteStudents(e.target.checked)}
              />
              학생 학년 +1 (진급)
            </label>
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={copyTeachers}
                onChange={(e) => setCopyTeachers(e.target.checked)}
              />
              교직원 명단 그대로 복제 (담임반은 미배정)
            </label>
            <label className="flex items-center gap-2 text-body">
              졸업 학년:
              <input
                type="number"
                value={graduateGrade}
                onChange={(e) => setGraduateGrade(e.target.value === "" ? "" : parseInt(e.target.value))}
                placeholder="3 (예: 고3)"
                className="w-20 px-2 py-1 text-body border border-border-default rounded bg-bg-primary"
              />
              <span className="text-caption text-text-tertiary">이 학년은 졸업 처리</span>
            </label>
          </div>
        </div>

        {preview && (
          <div className="mt-4 p-3 border border-border-default rounded bg-bg-secondary">
            <div className="flex items-center gap-2 text-caption mb-2">
              <AlertCircle size={14} className="text-status-warning" />
              {preview.dry_run ? "미리보기 (아직 반영 안 됨)" : "반영 결과"}
            </div>
            <div className="text-body text-text-primary">
              진급 <b>{preview.promoted}</b> · 졸업 <b>{preview.graduated}</b> · 교직원 복제 <b>{preview.copied_teachers}</b> · 스킵 <b>{preview.skipped}</b>
            </div>
            {preview.plan_preview && preview.plan_preview.length > 0 && (
              <div className="text-caption text-text-secondary mt-2 max-h-40 overflow-y-auto">
                {preview.plan_preview.slice(0, 10).map((p: any, i: number) => (
                  <div key={i}>
                    user_id={p.user_id} / role={p.role}
                    {p.from_grade !== undefined && ` / ${p.from_grade}학년→${p.to_grade ?? "졸업"}`}
                    {p.department && ` / ${p.department}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            닫기
          </button>
          <button
            onClick={() => run(true)}
            disabled={running}
            className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
          >
            미리보기 (dry-run)
          </button>
          <button
            onClick={() => run(false)}
            disabled={running || !preview}
            className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
            title={!preview ? "먼저 미리보기를 실행하세요" : ""}
          >
            {running ? "처리 중..." : "실제 반영"}
          </button>
        </div>
      </div>
    </div>
  );
}
