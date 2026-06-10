"use client";

/**
 * 비공개 댓글 — 학생 ↔ 교사 1:1 스레드 (Google Classroom Private comments).
 *
 * variant="card":  학생 과제 상세 우측 사이드바 (내 과제 카드 아래)
 * variant="inline": 교사 제출 현황 행 안 (학생별 스레드 + 답글)
 *
 * 수업 댓글(전체 공개)과 별개 — 이 스레드는 해당 학생과 강좌 교사만 본다.
 */

import { useCallback, useEffect, useState } from "react";
import { Lock, Send, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

interface PrivateCommentItem {
  id: number;
  author_id: number | null;
  author_name: string | null;
  is_student_author: boolean;
  content: string;
  created_at: string | null;
}

function rel(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export function PrivateComments({
  postId, studentId, variant = "card",
}: {
  postId: number;
  /** 교사 모드 — 대상 학생 user_id. 미지정이면 학생 본인 스레드 */
  studentId?: number;
  variant?: "card" | "inline";
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<PrivateCommentItem[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = studentId ? `?student_id=${studentId}` : "";
      const r = await api.get<{ items: PrivateCommentItem[] }>(
        `/api/classroom/posts/${postId}/private-comments${p}`,
      );
      setItems(r.items || []);
    } catch {
      setItems(null); // 권한 없음(자료 글 등) → 영역 숨김
    }
  }, [postId, studentId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const item = await api.post<PrivateCommentItem>(
        `/api/classroom/posts/${postId}/private-comments`,
        { content: trimmed, ...(studentId ? { student_id: studentId } : {}) },
      );
      setItems((prev) => [...(prev || []), item]);
      setText("");
    } catch (e: any) {
      alert(e?.detail || "비공개 댓글 작성 실패");
    } finally {
      setSending(false);
    }
  };

  if (items === null) return null;

  const thread = (
    <>
      {items.length > 0 && (
        <div className="space-y-2.5 mb-2.5">
          {items.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center flex-shrink-0 text-[10px] font-semibold mt-0.5">
                {c.author_name?.slice(0, 1) || "?"}
              </div>
              <div className="min-w-0">
                <div className="text-[11px]">
                  <span className="font-medium text-text-primary">{c.author_name || "(알 수 없음)"}</span>
                  <span className="text-text-tertiary ml-1.5">
                    {c.created_at && rel(c.created_at)}
                  </span>
                </div>
                <div className="text-caption text-text-primary whitespace-pre-wrap break-words">
                  {c.content}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder={studentId ? "비공개 댓글 추가..." : "교사님에게 비공개 댓글 추가..."}
          className="flex-1 min-w-0 px-3 py-1.5 text-caption border border-border-default rounded-full bg-bg-primary outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="text-accent disabled:opacity-40 p-1.5"
          title="보내기"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </>
  );

  if (variant === "inline") {
    return (
      <div className="mt-2.5 pt-2.5 border-t border-border-default">
        <div className="text-[10.5px] text-text-tertiary mb-2 inline-flex items-center gap-1">
          <Lock size={9} /> 비공개 댓글 (이 학생과 교사만)
        </div>
        {thread}
      </div>
    );
  }

  return (
    <div className="bg-bg-primary border border-border-default rounded-xl p-4 shadow-sm">
      <div className="text-[13px] font-medium text-text-primary mb-2.5 inline-flex items-center gap-1.5">
        <Lock size={12} className="text-text-tertiary" /> 비공개 댓글
      </div>
      {thread}
    </div>
  );
}
