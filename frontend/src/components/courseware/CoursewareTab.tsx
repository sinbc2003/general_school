"use client";

/**
 * 강좌 안 '문제' 탭 — 문제 세트 list + 출제 (교사) / 풀이 진입 (학생).
 *
 * variant:
 *  - admin   : 출제 모달 진입, 세트 publish/close, 결과 페이지 링크
 *  - student : 풀이 페이지 링크 (status=published 만 보임 — backend 필터)
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FileQuestion, CheckCircle2, Clock, PenLine, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { ProblemSetCreateModal } from "./ProblemSetCreateModal";
import type { ProblemSetSummary } from "./types";
import { STATUS_LABEL, STATUS_BADGE_TONE } from "./types";

interface Props {
  cid: number;
  canEdit: boolean;
  variant: "admin" | "student";
}

export function CoursewareTab({ cid, canEdit, variant }: Props) {
  const toast = useToast();
  const [sets, setSets] = useState<ProblemSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: ProblemSetSummary[] }>(
        `/api/courseware/courses/${cid}/problem-sets`,
      );
      setSets(res.items);
    } catch (e: any) {
      toast.show(e?.detail || "조회 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [cid, toast]);

  useEffect(() => { load(); }, [load]);

  const handlePublish = async (psid: number) => {
    try {
      await api.post(`/api/courseware/problem-sets/${psid}/publish`);
      toast.show("게시됨", "success");
      load();
    } catch (e: any) {
      toast.show(e?.detail || "실패", "error");
    }
  };
  const handleClose = async (psid: number) => {
    if (!confirm("마감하면 학생이 더 이상 제출할 수 없습니다. 진행할까요?")) return;
    try {
      await api.post(`/api/courseware/problem-sets/${psid}/close`);
      toast.show("마감됨", "success");
      load();
    } catch (e: any) {
      toast.show(e?.detail || "실패", "error");
    }
  };
  const handleDelete = async (psid: number) => {
    if (!confirm("이 문제 세트를 휴지통으로 보냅니다.")) return;
    try {
      await api.delete(`/api/courseware/problem-sets/${psid}`);
      toast.show("삭제됨", "success");
      load();
    } catch (e: any) {
      toast.show(e?.detail || "실패", "error");
    }
  };

  if (loading) {
    return <div className="text-text-tertiary text-body">로딩 중...</div>;
  }

  const detailHref = (psid: number) =>
    variant === "admin"
      ? `/classroom/${cid}/courseware/${psid}`
      : `/s/classroom/${cid}/courseware/${psid}`;

  return (
    <div className="space-y-3">
      {canEdit && variant === "admin" && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-caption bg-accent-default text-white rounded hover:opacity-90 flex items-center gap-1"
          >
            <Plus size={14} /> 문제 세트 출제
          </button>
        </div>
      )}

      {sets.length === 0 ? (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-12 text-center">
          <FileQuestion size={28} className="mx-auto text-text-tertiary opacity-30 mb-2" />
          <div className="text-body text-text-secondary mb-1">
            {variant === "admin" ? "출제된 문제 세트가 없습니다" : "아직 출제된 문제가 없습니다"}
          </div>
          <div className="text-caption text-text-tertiary">
            {variant === "admin"
              ? "오른쪽 위 '문제 세트 출제' 버튼으로 시작하세요"
              : "교사가 문제를 게시하면 여기 표시됩니다"}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {sets.map((ps) => {
            const dueText = ps.due_date
              ? new Date(ps.due_date).toLocaleString("ko-KR", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit",
                })
              : "기한 없음";
            return (
              <div
                key={ps.id}
                className="bg-bg-primary border border-border-default rounded-lg p-4 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={detailHref(ps.id)}
                        className="text-body font-semibold text-text-primary hover:underline"
                      >
                        {ps.title}
                      </Link>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE_TONE[ps.status]}`}
                      >
                        {STATUS_LABEL[ps.status]}
                      </span>
                    </div>
                    {ps.description && (
                      <div className="text-caption text-text-secondary mb-1.5 line-clamp-2">
                        {ps.description}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-caption text-text-tertiary">
                      <span className="flex items-center gap-1">
                        <FileQuestion size={12} /> {ps.problem_count}문제
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {dueText}
                      </span>
                      <span>재응시 {ps.max_attempts}회</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canEdit && variant === "admin" && (
                      <>
                        {ps.status === "draft" && (
                          <button
                            type="button"
                            onClick={() => handlePublish(ps.id)}
                            className="text-caption px-2 py-1 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50"
                          >
                            게시
                          </button>
                        )}
                        {ps.status === "published" && (
                          <button
                            type="button"
                            onClick={() => handleClose(ps.id)}
                            className="text-caption px-2 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
                          >
                            마감
                          </button>
                        )}
                        <Link
                          href={detailHref(ps.id)}
                          className="text-text-tertiary hover:text-text-primary p-1"
                          aria-label="편집"
                        >
                          <PenLine size={14} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(ps.id)}
                          className="text-text-tertiary hover:text-red-600 p-1"
                          aria-label="삭제"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                    {variant === "student" && (
                      <Link
                        href={detailHref(ps.id)}
                        className="text-caption px-3 py-1 bg-accent-default text-white rounded hover:opacity-90 flex items-center gap-1"
                      >
                        <CheckCircle2 size={12} /> 풀이
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && variant === "admin" && (
        <ProblemSetCreateModal
          cid={cid}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}
