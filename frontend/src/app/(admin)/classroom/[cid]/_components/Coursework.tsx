"use client";

/**
 * 수업 과제 탭 — Google Classroom 식.
 *
 * 구조:
 *   CourseworkTab → TopicGroup[] → CourseworkItem[]
 *
 * - 상단: 주제 필터 드롭다운 + "모두 접기/펼치기" 토글
 * - 주제별 큰 헤더 + chevron으로 fold
 * - CourseworkItem 클릭 시 인라인 펼침 — 기한 + 제출함/할당됨 + 본문 + 상세 링크
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreateMenu, type CreateActionKind } from "@/components/classroom/CreateMenu";
import { ClipboardListIcon, FolderIcon, DotsIcon } from "./icons";
import type { Post } from "./types";


export function CourseworkTab({
  cid, posts, canEdit, tone, studentCount, onCreate, onDelete, onEdit, onDuplicate,
}: {
  cid: number; posts: Post[]; canEdit: boolean;
  tone: { accent: string };
  studentCount: number;
  onCreate: (kind: CreateActionKind) => void;
  onDelete: (pid: number) => void;
  onEdit: (post: Post) => void;
  onDuplicate: (post: Post) => void;
}) {
  // 과제·자료만 (공지는 게시판 탭에서)
  const materials = posts.filter((p) => p.post_type !== "notice");
  const allTopics = Array.from(new Set(materials.map((p) => p.topic).filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b, "ko"));
  const [topicFilter, setTopicFilter] = useState<string>("__all__"); // __all__ | topic | __none__

  const filtered = topicFilter === "__all__"
    ? materials
    : topicFilter === "__none__"
      ? materials.filter((p) => !p.topic)
      : materials.filter((p) => p.topic === topicFilter);

  const groups: Record<string, Post[]> = {};
  for (const p of filtered) {
    const key = p.topic || "주제 없음";
    groups[key] = groups[key] || [];
    groups[key].push(p);
  }
  const topicOrder = Object.keys(groups).sort((a, b) => {
    if (a === "주제 없음") return 1;
    if (b === "주제 없음") return -1;
    return a.localeCompare(b, "ko");
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const allCollapsed = collapsed.size > 0 && collapsed.size >= topicOrder.length;
  const toggleAll = () => {
    if (allCollapsed) setCollapsed(new Set());
    else setCollapsed(new Set(topicOrder));
  };

  return (
    <div className="space-y-5">
      {canEdit && (
        <div className="flex items-center gap-3">
          <CreateMenu onAction={onCreate} accentColor={tone.accent} />
          <Link
            href={`/classroom/${cid}/docs`}
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
          >
            협업 문서 →
          </Link>
          <Link
            href={`/classroom/${cid}/surveys`}
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
          >
            설문 →
          </Link>
        </div>
      )}

      {materials.length === 0 ? (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 px-6 text-center">
          <div className="text-body text-text-secondary mb-2">과제물을 할당하는 공간</div>
          <div className="text-caption text-text-tertiary">
            학생들을 위한 과제와 자료를 추가하면 여기에 표시됩니다
          </div>
        </div>
      ) : (
        <>
          {/* 주제 필터 + 모두 접기 */}
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex-1 max-w-sm">
              <label className="block text-[10.5px] text-text-tertiary mb-1 px-3">주제 필터</label>
              <div className="relative">
                <select
                  value={topicFilter}
                  onChange={(e) => setTopicFilter(e.target.value)}
                  className="w-full pl-3 pr-8 py-2.5 text-body bg-bg-primary border border-border-default rounded-md appearance-none cursor-pointer hover:border-text-tertiary"
                >
                  <option value="__all__">모든 주제</option>
                  {allTopics.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  <option value="__none__">주제 없음</option>
                </select>
                <svg
                  className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-tertiary"
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            {topicOrder.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-caption text-accent hover:underline inline-flex items-center gap-1 whitespace-nowrap"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="18 15 12 9 6 15"></polyline>
                  <polyline points="6 21 12 15 18 21"></polyline>
                </svg>
                {allCollapsed ? "모두 펼치기" : "모두 접기"}
              </button>
            )}
          </div>

          {topicOrder.map((topicKey) => (
            <TopicGroup
              key={topicKey}
              topic={topicKey}
              posts={groups[topicKey]}
              collapsed={collapsed.has(topicKey)}
              onToggle={() => toggleCollapse(topicKey)}
              canEdit={canEdit}
              onDelete={onDelete}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              studentCount={studentCount}
              cid={cid}
            />
          ))}
        </>
      )}
    </div>
  );
}


function TopicGroup({
  topic, posts, collapsed, onToggle, canEdit, onDelete, onEdit, onDuplicate,
  studentCount, cid,
}: {
  topic: string; posts: Post[]; collapsed: boolean; onToggle: () => void;
  canEdit: boolean; onDelete: (pid: number) => void;
  onEdit: (post: Post) => void;
  onDuplicate: (post: Post) => void;
  studentCount: number;
  cid: number;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-2 px-1 border-b border-border-default text-left group"
      >
        <div className="text-[20px] font-medium text-text-primary group-hover:opacity-90">
          {topic}
        </div>
        <svg
          width="20" height="20" viewBox="0 0 24 24"
          className={`text-text-tertiary transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
      {!collapsed && (
        <div className="mt-2 space-y-2">
          {posts.map((p) => (
            <CourseworkItem
              key={p.id}
              post={p}
              canEdit={canEdit}
              onDelete={() => onDelete(p.id)}
              onEdit={() => onEdit(p)}
              onDuplicate={() => onDuplicate(p)}
              studentCount={studentCount}
              cid={cid}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function CourseworkItem({
  post, canEdit, onDelete, onEdit, onDuplicate, studentCount, cid,
}: {
  post: Post; canEdit: boolean;
  onDelete: () => void; onEdit: () => void; onDuplicate: () => void;
  studentCount: number;
  cid: number;
}) {
  const isAssignment = post.post_type === "assignment_ref";
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  const dateStr = post.created_at
    ? new Date(post.created_at).toLocaleDateString("ko-KR", {
        year: "numeric", month: "numeric", day: "numeric",
      })
    : "";

  const dueStr = post.due_date
    ? `기한 ${new Date(post.due_date).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`
    : "기한 없음";

  const goDetail = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/classroom/${cid}/posts/${post.id}`);
  };

  return (
    <div
      className={`bg-bg-primary border rounded-lg transition ${
        expanded ? "border-accent shadow-sm" : "border-border-default hover:shadow-sm"
      }`}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        className={`group flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-bg-secondary ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: isAssignment
              ? "linear-gradient(135deg, #fde4b8 0%, #fbbf24 100%)"
              : "linear-gradient(135deg, #bbf7d0 0%, #4ade80 100%)",
            color: isAssignment ? "#a16207" : "#15803d",
          }}
        >
          {isAssignment ? <ClipboardListIcon /> : <FolderIcon />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] text-text-primary truncate">{post.title}</div>
        </div>
        <div className="text-[12.5px] text-text-tertiary whitespace-nowrap">
          게시일: {dateStr}
        </div>
        {canEdit && (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="w-7 h-7 rounded-full hover:bg-bg-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              title="더보기"
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
                <div className="absolute top-full right-0 mt-1 z-20 bg-bg-primary border border-border-default rounded shadow-lg w-32 py-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
                    className="w-full text-left px-3 py-1.5 text-caption text-text-primary hover:bg-bg-secondary"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}
                    className="w-full text-left px-3 py-1.5 text-caption text-text-primary hover:bg-bg-secondary"
                  >
                    복제
                  </button>
                  <div className="border-t border-border-default my-1" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                    className="w-full text-left px-3 py-1.5 text-caption text-status-error hover:bg-bg-secondary"
                  >
                    삭제
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="px-5 pb-4 border-t border-border-default rounded-b-lg">
          <div className="flex items-start gap-4 pt-4">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-text-primary mb-1">
                {dueStr}
              </div>
              {post.content && (
                <div className="text-caption text-text-secondary whitespace-pre-wrap line-clamp-6 mt-3">
                  {post.content}
                </div>
              )}
              {post.author_name && (
                <div className="text-[11.5px] text-text-tertiary mt-3">— {post.author_name}</div>
              )}
            </div>
            {isAssignment && (
              <div className="flex items-stretch gap-0 text-center">
                <div className="px-5 border-l border-border-default">
                  <div className="text-[26px] font-light text-text-primary leading-tight">
                    {post.turned_in_count ?? 0}
                  </div>
                  <div className="text-[11.5px] text-text-tertiary mt-1">제출함</div>
                </div>
                <div className="px-5 border-l border-border-default">
                  <div className="text-[26px] font-light text-text-primary leading-tight">{studentCount}</div>
                  <div className="text-[11.5px] text-text-tertiary mt-1">할당됨</div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-border-default">
            <button
              type="button"
              onClick={goDetail}
              className="text-caption text-accent hover:underline"
            >
              {isAssignment ? "과제 안내 보기" : "자료 보기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
