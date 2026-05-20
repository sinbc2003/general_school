"use client";

/**
 * 과제·자료 상세 페이지 본문 — admin·student 공유.
 *
 * Google Classroom의 과제 상세 화면을 단순화.
 * - 큰 아이콘 + 제목 + 게시일 + 작성자
 * - 기한·점수 강조
 * - 본문 (안내문)
 * - 첨부 list (downloadSecure 헬퍼로 인증 다운로드)
 *
 * baseHref로 admin/student 진입 경로 분기.
 */

import Link from "next/link";
import {
  ArrowLeft, ClipboardList, Folder, Paperclip, Link as LinkIcon,
  Award, Calendar, Hash, User as UserIcon, MessageCircle, Send, Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { downloadSecure } from "@/lib/api/download";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

export interface Attachment {
  type: "link" | "file" | "doc" | "survey";
  title: string;
  url?: string;
  file_url?: string;
  file_name?: string;
}

export interface PostDetail {
  id: number;
  course_id: number;
  course_name?: string;
  course_subject?: string;
  course_class_name?: string | null;
  post_type: string;
  title: string;
  content: string;
  author_name?: string;
  due_date: string | null;
  max_score: number | null;
  topic: string | null;
  attachments: Attachment[];
  created_at: string | null;
}

interface PostDetailViewProps {
  post: PostDetail;
  baseHref?: string;
}

export function PostDetailView({ post, baseHref = "/classroom" }: PostDetailViewProps) {
  const isAssignment = post.post_type === "assignment_ref";
  const isMaterial = post.post_type === "material";
  const isNotice = post.post_type === "notice";
  const Icon = isAssignment ? ClipboardList : isMaterial ? Folder : ClipboardList;

  const iconBg = isAssignment ? "#fef3c7" : isMaterial ? "#dcfce7" : "#dbeafe";
  const iconColor = isAssignment ? "#a16207" : isMaterial ? "#15803d" : "#1d4ed8";

  const kindLabel = isAssignment ? "과제" : isMaterial ? "자료" : "공지";

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <Link
          href={`${baseHref}/${post.course_id}`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> {post.course_name || "강좌"}로
        </Link>
      </div>

      {/* 헤더 카드 */}
      <div className="bg-bg-primary border border-border-default rounded-xl p-5 mb-4">
        <div className="flex items-start gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: iconBg, color: iconColor }}
          >
            <Icon size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className="text-[10.5px] px-2 py-0.5 rounded font-medium uppercase tracking-wide"
                style={{ backgroundColor: iconBg, color: iconColor }}
              >
                {kindLabel}
              </span>
              {post.topic && (
                <span className="text-[10.5px] px-2 py-0.5 bg-cream-200 text-text-secondary rounded inline-flex items-center gap-1">
                  <Hash size={9} /> {post.topic}
                </span>
              )}
            </div>
            <h1 className="text-title font-bold text-text-primary">{post.title}</h1>
            <div className="text-caption text-text-tertiary mt-1 flex items-center gap-3 flex-wrap">
              {post.author_name && (
                <span className="inline-flex items-center gap-1">
                  <UserIcon size={11} /> {post.author_name}
                </span>
              )}
              <span>
                게시일 {post.created_at && new Date(post.created_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
            {(post.due_date || post.max_score != null) && (
              <div className="flex items-center gap-3 mt-3">
                {post.due_date && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded text-caption text-status-error">
                    <Calendar size={12} />
                    기한 {new Date(post.due_date).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                )}
                {post.max_score != null && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded text-caption text-amber-800">
                    <Award size={12} /> {post.max_score}점
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 본문 */}
      {post.content && post.content !== post.title && (
        <div className="bg-bg-primary border border-border-default rounded-xl p-5 mb-4">
          <div className="text-[11.5px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
            안내
          </div>
          <div className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
            {post.content}
          </div>
        </div>
      )}

      {/* 첨부 */}
      {post.attachments.length > 0 && (
        <div className="bg-bg-primary border border-border-default rounded-xl p-5">
          <div className="text-[11.5px] font-semibold text-text-tertiary uppercase tracking-wide mb-3">
            첨부 ({post.attachments.length})
          </div>
          <div className="space-y-2">
            {post.attachments.map((a, i) => (
              <AttachmentRow key={i} a={a} />
            ))}
          </div>
        </div>
      )}

      {isNotice && (
        <div className="text-caption text-text-tertiary text-center mt-6 mb-4">
          공지글입니다. 별도 제출은 없습니다.
        </div>
      )}

      {/* 수업 댓글 — Google Classroom 식 */}
      <CommentsSection postId={post.id} />
    </div>
  );
}


// ─── 수업 댓글 (Google Classroom 식) ─────────────────────────────────────
interface CommentItem {
  id: number;
  post_id: number;
  author_id: number | null;
  author_name: string | null;
  content: string;
  created_at: string | null;
}

function CommentsSection({ postId }: { postId: number }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: CommentItem[] }>(
        `/api/classroom/posts/${postId}/comments`,
      );
      setItems(data.items);
    } catch (e: any) {
      // 권한 없으면 조용히 (학기 만료 등 — 댓글 영역 자체 안 보이게)
      console.warn("comment load failed", e);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const item = await api.post<CommentItem>(
        `/api/classroom/posts/${postId}/comments`,
        { content: trimmed },
      );
      setItems((prev) => [...prev, item]);
      setText("");
    } catch (e: any) {
      alert(e?.detail || "댓글 작성 실패");
    } finally {
      setSending(false);
    }
  };

  const del = async (cid: number) => {
    if (!confirm("이 댓글을 삭제합니까?")) return;
    try {
      await api.delete(`/api/classroom/posts/comments/${cid}`);
      setItems((prev) => prev.filter((c) => c.id !== cid));
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const canDelete = (c: CommentItem) =>
    user && (c.author_id === user.id || ["super_admin", "designated_admin", "teacher"].includes(user.role));

  return (
    <div className="mt-6 bg-bg-primary border border-border-default rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3 text-text-secondary">
        <MessageCircle size={16} />
        <span className="text-body font-medium">수업 댓글</span>
        <span className="text-caption text-text-tertiary">{items.length}</span>
      </div>

      {loading ? (
        <div className="text-caption text-text-tertiary py-4 text-center">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="text-caption text-text-tertiary py-3 text-center">
          아직 댓글이 없습니다
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          {items.map((c) => (
            <div key={c.id} className="flex items-start gap-3 group">
              <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center flex-shrink-0 text-[12px] font-semibold">
                {c.author_name?.slice(0, 1) || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="font-medium text-text-primary">{c.author_name || "(알 수 없음)"}</span>
                  <span className="text-text-tertiary text-[11px]">
                    {c.created_at && formatRel(c.created_at)}
                  </span>
                </div>
                <div className="text-caption text-text-primary whitespace-pre-wrap mt-0.5">
                  {c.content}
                </div>
              </div>
              {canDelete(c) && (
                <button
                  type="button"
                  onClick={() => del(c.id)}
                  className="text-text-tertiary hover:text-status-error opacity-0 group-hover:opacity-100 transition"
                  title="삭제"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 입력 — Google Classroom 식 (rounded input + 전송 버튼) */}
      <div className="flex items-center gap-2 pt-3 border-t border-border-default">
        <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center flex-shrink-0 text-[12px] font-semibold">
          {user?.name?.slice(0, 1) || "?"}
        </div>
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 border border-border-default rounded-full bg-bg-secondary focus-within:border-accent">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="수업 댓글 추가..."
            disabled={sending}
            className="flex-1 bg-transparent text-caption text-text-primary placeholder-text-tertiary focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="text-accent hover:text-accent-hover disabled:opacity-30 disabled:cursor-not-allowed p-1"
            title="댓글 작성 (Enter)"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRel(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const sec = Math.floor((now - d.getTime()) / 1000);
  if (sec < 60) return "방금";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return d.toLocaleDateString("ko-KR");
}

function AttachmentRow({ a }: { a: Attachment }) {
  if (a.type === "file" && a.file_url) {
    return (
      <button
        type="button"
        onClick={() => downloadSecure(a.file_url!, a.file_name || a.title)}
        className="w-full flex items-center gap-3 px-3 py-2.5 border border-border-default rounded hover:bg-bg-secondary group text-left"
      >
        <Paperclip size={14} className="text-text-tertiary" />
        <div className="flex-1 min-w-0">
          <div className="text-body text-text-primary truncate">{a.title}</div>
          {a.file_name && a.file_name !== a.title && (
            <div className="text-[11px] text-text-tertiary truncate">{a.file_name}</div>
          )}
        </div>
        <span className="text-[11px] text-accent opacity-0 group-hover:opacity-100">
          다운로드 →
        </span>
      </button>
    );
  }
  if (a.url) {
    return (
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2.5 border border-border-default rounded hover:bg-bg-secondary group"
      >
        <LinkIcon size={14} className="text-text-tertiary" />
        <div className="flex-1 min-w-0">
          <div className="text-body text-accent truncate">{a.title}</div>
          <div className="text-[11px] text-text-tertiary truncate">{a.url}</div>
        </div>
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border border-border-default rounded text-text-tertiary">
      <LinkIcon size={14} />
      <span className="text-body">{a.title}</span>
    </div>
  );
}
