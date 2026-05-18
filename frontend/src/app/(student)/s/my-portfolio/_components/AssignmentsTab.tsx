"use client";

/**
 * 과제 제출물 탭 — 본인이 제출한 과제 목록 + 포트폴리오 노출 토글.
 *
 * show_in_portfolio=True면 PDF 생기부 + 공개 갤러리에 자동 포함.
 * 교사 검토(reviewed) 전엔 학생 단독 삭제 가능.
 */

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import type { AssignmentSubmission } from "../_shared";
import { EmptyState } from "../_shared";


export function AssignmentsTab() {
  const [items, setItems] = useState<AssignmentSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/assignment-submissions");
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (s: AssignmentSubmission) => {
    try {
      await api.put(`/api/me/assignment-submissions/${s.id}/portfolio-visibility`, {
        show_in_portfolio: !s.show_in_portfolio,
      });
      setItems((prev) => prev.map((p) => p.id === s.id ? { ...p, show_in_portfolio: !p.show_in_portfolio } : p));
    } catch (e: any) {
      alert(e?.detail || "토글 실패");
    }
  };

  const remove = async (s: AssignmentSubmission) => {
    if (!confirm(`"${s.assignment_title}" 제출물을 삭제하시겠습니까? (교사가 검토하기 전에만 가능)`)) return;
    try {
      await api.delete(`/api/me/assignment-submissions/${s.id}`);
      setItems((prev) => prev.filter((p) => p.id !== s.id));
    } catch (e: any) {
      alert(e?.detail || "삭제 실패 (이미 검토되었을 수 있음)");
    }
  };

  const visibleCount = items.filter((s) => s.show_in_portfolio).length;

  return (
    <div>
      <div className="mb-4 p-3 bg-cream-100 border border-cream-300 rounded-lg">
        <div className="text-caption text-blue-900">
          ⓘ 과제 제출물을 <b>"포트폴리오 노출"</b>로 켜면 PDF 생기부, 공개 갤러리에 자동으로 포함됩니다.
          {" "}현재 노출 중: <b>{visibleCount}개</b> / 전체 {items.length}개
        </div>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <EmptyState text="아직 과제 제출 기록이 없습니다" />
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="bg-bg-primary border border-border-default rounded-lg p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-body text-text-primary font-medium">{s.assignment_title}</div>
                  <div className="text-caption text-text-tertiary mt-0.5">
                    {s.subject} {s.filename && `· ${s.filename}`} {s.submitted_at && `· ${s.submitted_at.slice(0, 10)}`}
                  </div>
                  {s.review_comment && (
                    <div className="text-caption text-text-secondary mt-1 italic">교사 코멘트: {s.review_comment}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggle(s)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-caption border ${
                      s.show_in_portfolio
                        ? "bg-green-50 border-green-300 text-green-700"
                        : "bg-bg-secondary border-border-default text-text-tertiary"
                    }`}
                  >
                    {s.show_in_portfolio ? <Eye size={13} /> : <EyeOff size={13} />}
                    {s.show_in_portfolio ? "노출 ON" : "노출 OFF"}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    className="p-1.5 text-text-tertiary hover:text-status-error"
                    title="제출물 삭제 (검토 전만 가능)"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
