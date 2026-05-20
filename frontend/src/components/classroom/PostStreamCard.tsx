"use client";

/**
 * 스트림(게시판) 글 카드 — 실제 Google Classroom과 같은 row 스타일.
 *
 * 구성:
 *   ┌──────────────────────────────────────────────┐
 *   │ [📋]  김지원님이 새 과제 게시: 7. 교과형… ⋮ │
 *   │      2022. 12. 22.                           │
 *   └──────────────────────────────────────────────┘
 *
 * - 좌측: 작은 오렌지 클립보드 원형 아이콘 (40px)
 * - 중앙: "{author}님이 새 {type} 게시: {title}" — Google의 정형 문구
 * - 우측: 날짜 (작은 회색) + ⋮ 더보기 메뉴 (admin/teacher만)
 * - 카드 자체: 옅은 회색 배경 + hover 시 살짝 더 진해짐
 * - 클릭 시 상세 페이지로
 *
 * 공지(notice): 클립보드 대신 confetti 아이콘 + "새 공지사항을 게시했습니다" 문구.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pin } from "lucide-react";

interface PostStreamCardProps {
  post: {
    id: number;
    course_id: number;
    post_type: string;
    title: string;
    is_pinned: boolean;
    author_name?: string;
    created_at: string | null;
    due_date?: string | null;
  };
  /** 강좌 detail base path. admin: /classroom, student: /s/classroom */
  baseHref?: string;
  canEdit?: boolean;
  onDelete?: (pid: number) => void;
  onEdit?: (pid: number) => void;
  onDuplicate?: (pid: number) => void;
}

const TYPE_LABEL: Record<string, string> = {
  notice: "공지사항",
  material: "자료",
  assignment_ref: "과제",
};

export function PostStreamCard({
  post, baseHref = "/classroom", canEdit, onDelete, onEdit, onDuplicate,
}: PostStreamCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const isNotice = post.post_type === "notice";
  const isAssignment = post.post_type === "assignment_ref";
  const verb = isNotice ? "공지사항을 게시했습니다" : `새 ${TYPE_LABEL[post.post_type] ?? "글"} 게시: ${post.title}`;
  const headline = post.author_name
    ? (isNotice
        ? `${post.author_name}님이 새 공지사항을 게시했습니다`
        : `${post.author_name}님이 ${verb}`)
    : (isNotice ? "새 공지사항" : post.title);

  const dateStr = post.created_at
    ? new Date(post.created_at).toLocaleDateString("ko-KR", {
        year: "numeric", month: "numeric", day: "numeric",
      })
    : "";

  const go = () => router.push(`${baseHref}/${post.course_id}/posts/${post.id}`);

  return (
    <div
      onClick={go}
      className="group bg-bg-primary border border-border-default rounded-lg px-5 py-3.5 cursor-pointer hover:shadow-sm transition flex items-start gap-3.5"
    >
      {/* 좌측 아이콘 — 오렌지 톤 클립보드 (공지는 회색 톤) */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: isNotice
            ? "linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%)"
            : "linear-gradient(135deg, #fde4b8 0%, #fbbf24 100%)",
          color: isNotice ? "#4b5563" : "#a16207",
        }}
      >
        <ClipboardIcon />
      </div>

      {/* 중앙 — headline + (공지면 본문 첫 줄) */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-1.5">
          {post.is_pinned && (
            <Pin size={12} className="text-accent flex-shrink-0" />
          )}
          <div className="text-[14.5px] text-text-primary truncate">
            {headline}
          </div>
        </div>
        {isNotice && (
          <div className="text-[12.5px] text-text-tertiary mt-1 line-clamp-1">
            {post.title}
          </div>
        )}
      </div>

      {/* 우측 — 날짜 + kebab 메뉴 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-[12.5px] text-text-tertiary whitespace-nowrap">
          {dateStr}
        </div>
        {canEdit && (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="w-7 h-7 rounded-full hover:bg-bg-secondary flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              title="더보기"
              aria-label="더보기"
            >
              <KebabIcon />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
                <div className="absolute top-full right-0 mt-1 z-20 bg-bg-primary border border-border-default rounded shadow-lg w-32 py-1">
                  {onEdit && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(post.id); }}
                      className="w-full text-left px-3 py-1.5 text-caption text-text-primary hover:bg-bg-secondary"
                    >
                      수정
                    </button>
                  )}
                  {onDuplicate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDuplicate(post.id); }}
                      className="w-full text-left px-3 py-1.5 text-caption text-text-primary hover:bg-bg-secondary"
                    >
                      복제
                    </button>
                  )}
                  {(onEdit || onDuplicate) && onDelete && (
                    <div className="border-t border-border-default my-1" />
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(post.id); }}
                      className="w-full text-left px-3 py-1.5 text-caption text-status-error hover:bg-bg-secondary"
                    >
                      삭제
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ClipboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-text-tertiary">
      <circle cx="12" cy="6" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="18" r="1.7" />
    </svg>
  );
}
