"use client";

/**
 * 학생 일괄 등록 모달.
 *
 * 한국 학교 표준 5자리 학번(`10101` = 1학년 1반 1번)을 쉼표·공백·줄바꿈으로
 * 구분해 입력. 서버가 학번 → User lookup 후 CourseStudent 생성.
 */

import { useState } from "react";
import { X, UserPlus } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";

export function BulkAddModal({
  cid, onClose, onSaved,
}: { cid: number; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const save = async () => {
    const numbers = text
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));
    if (numbers.length === 0) {
      toast.show("학번을 입력하세요", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ added: number; skipped: number; reactivated: number; errors?: string[] }>(
        `/api/classroom/courses/${cid}/students/bulk`,
        { student_numbers: numbers },
      );
      const parts: string[] = [];
      if (res.added) parts.push(`추가 ${res.added}`);
      if (res.reactivated) parts.push(`재활성화 ${res.reactivated}`);
      if (res.skipped) parts.push(`중복 ${res.skipped}`);
      toast.show(`학생 등록: ${parts.join(" · ") || "변경 없음"}`, "success");
      onSaved();
    } catch (e: any) {
      toast.show(e?.detail || "실패", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold">학생 일괄 등록</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-caption text-text-secondary">
            한국 학교 표준 5자리 학번(<b>10101</b> = 1학년 1반 1번)을 쉼표·공백·줄바꿈으로 구분해 입력하세요.
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="예시:&#10;20315&#10;20316&#10;20317&#10;또는: 20315, 20316, 20317"
            className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary font-mono text-caption resize-y"
          />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border-default">
          <button onClick={onClose} className="px-4 py-1.5 text-caption border border-border-default rounded">취소</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded disabled:opacity-50"
          >
            <UserPlus size={14} /> {saving ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
