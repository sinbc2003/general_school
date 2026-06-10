"use client";

/**
 * 게시물 재사용 모달 — Google Classroom "게시물 재사용".
 *
 * 본인 강좌 목록 → 강좌 선택 → 과제·자료 글 목록 → 클릭하면 onPick(post).
 * parent가 AssignmentModal을 duplicate 모드로 열어 내용을 prefill한다
 * (기한은 비움, 첨부는 그대로 — 같은 교사 소유 자료라 접근 문제 없음).
 */

import { useEffect, useState } from "react";
import { Repeat2, Loader2, ClipboardList, Folder } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api/client";

export interface ReusablePost {
  id: number;
  post_type: string;
  title: string;
  content: string;
  max_score: number | null;
  due_date: string | null;
  topic: string | null;
  attachments: any[];
  created_at: string | null;
}

interface CourseRow {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
}

interface Props {
  currentCid: number;
  onClose: () => void;
  onPick: (post: ReusablePost) => void;
}

export function ReusePostModal({ currentCid, onClose, onPick }: Props) {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [selectedCid, setSelectedCid] = useState<number | null>(null);
  const [posts, setPosts] = useState<ReusablePost[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);

  // 본인 강좌 목록 (현재 학기)
  useEffect(() => {
    api.get<{ items: CourseRow[] }>("/api/classroom/courses")
      .then((r) => {
        const items = r.items || [];
        setCourses(items);
        // 기본 선택: 현재 강좌 (목록에 있으면), 없으면 첫 강좌
        const def = items.find((c) => c.id === currentCid) || items[0];
        if (def) setSelectedCid(def.id);
      })
      .catch(() => setCourses([]))
      .finally(() => setLoadingCourses(false));
  }, [currentCid]);

  // 선택 강좌의 과제·자료 글
  useEffect(() => {
    if (selectedCid == null) return;
    setLoadingPosts(true);
    api.get<{ items: ReusablePost[] }>(`/api/classroom/courses/${selectedCid}/posts`)
      .then((r) => {
        const items = (r.items || []).filter(
          (p) => p.post_type === "assignment_ref" || p.post_type === "material",
        );
        setPosts(items);
      })
      .catch(() => setPosts([]))
      .finally(() => setLoadingPosts(false));
  }, [selectedCid]);

  return (
    <Modal open onClose={onClose} title="게시물 재사용" icon={<Repeat2 size={16} />} maxWidth="lg">
      <p className="text-caption text-text-tertiary mb-3">
        가져올 글을 선택하면 작성 화면이 내용으로 채워집니다. 기한은 비워지며, 게시 전에 수정할 수 있습니다.
      </p>

      {/* 강좌 선택 */}
      <div className="mb-3">
        <label className="block text-caption text-text-secondary mb-1">강좌</label>
        {loadingCourses ? (
          <div className="text-caption text-text-tertiary inline-flex items-center gap-2 py-1.5">
            <Loader2 size={12} className="animate-spin" /> 강좌 불러오는 중...
          </div>
        ) : courses.length === 0 ? (
          <div className="text-caption text-text-tertiary py-1.5">본인 강좌가 없습니다.</div>
        ) : (
          <select
            value={selectedCid ?? ""}
            onChange={(e) => setSelectedCid(Number(e.target.value))}
            className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.id === currentCid ? " (현재 강좌)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 글 목록 */}
      <div className="border border-border-default rounded bg-bg-primary max-h-[380px] overflow-y-auto">
        {loadingPosts ? (
          <div className="px-3 py-8 text-caption text-text-tertiary inline-flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> 글 불러오는 중...
          </div>
        ) : posts.length === 0 ? (
          <div className="px-3 py-8 text-caption text-text-tertiary text-center">
            이 강좌에 재사용할 과제·자료가 없습니다
          </div>
        ) : (
          posts.map((p) => {
            const isAssignment = p.post_type === "assignment_ref";
            const dateStr = p.created_at
              ? new Date(p.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" })
              : "";
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-border-default last:border-b-0 hover:bg-bg-secondary"
              >
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: isAssignment ? "#fef3c7" : "#dcfce7",
                    color: isAssignment ? "#a16207" : "#15803d",
                  }}
                >
                  {isAssignment ? <ClipboardList size={14} /> : <Folder size={14} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-body text-text-primary truncate">{p.title}</span>
                  <span className="block text-[11px] text-text-tertiary">
                    {isAssignment ? "과제" : "자료"}
                    {p.topic ? ` · ${p.topic}` : ""}
                    {dateStr ? ` · ${dateStr}` : ""}
                    {(p.attachments?.length || 0) > 0 ? ` · 첨부 ${p.attachments.length}` : ""}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
