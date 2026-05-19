"use client";

/**
 * 강좌 프리젠테이션 deck 목록.
 *
 * Phase P1: deck 생성 + 목록만. 편집기는 P2.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Presentation, Plus, Pencil } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";

interface CourseDetail {
  id: number;
  name: string;
  teacher_id: number;
  viewer_role: "admin" | "teacher" | "student";
}

interface DeckItem {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  access_mode: string;
  is_archived: boolean;
  slide_count: number;
  updated_at: string | null;
}

export default function CourseDecksAdminPage() {
  const params = useParams();
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const toast = useToast();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [decks, setDecks] = useState<DeckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const canCreate = course
    ? course.viewer_role === "teacher" || course.viewer_role === "admin"
    : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, d] = await Promise.all([
        api.get<CourseDetail>(`/api/classroom/courses/${cid}`),
        api.get<{ items: DeckItem[] }>(`/api/classroom/decks?course_id=${cid}`),
      ]);
      setCourse(c);
      setDecks(d.items);
    } catch (e: any) {
      toast.show(e?.detail || "조회 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [cid, toast]);

  useEffect(() => { load(); }, [load]);

  const createDeck = async () => {
    setCreating(true);
    try {
      const d = await api.post<DeckItem>("/api/classroom/decks", {
        title: newTitle.trim() || "제목 없음 프리젠테이션",
        course_id: cid,
        access_mode: "course_members",
      });
      toast.show("프리젠테이션 생성됨", "success");
      router.push(`/classroom/${cid}/decks/${d.id}`);
    } catch (e: any) {
      toast.show(e?.detail || "생성 실패", "error");
      setCreating(false);
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!course) return null;

  return (
    <div>
      <div className="mb-4">
        <Link
          href={`/classroom/${cid}`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> {course.name}
        </Link>
        <h1 className="text-title text-text-primary mt-1 flex items-center gap-2">
          <Presentation size={20} /> 프리젠테이션
        </h1>
        <div className="text-caption text-text-tertiary mt-1">
          Google Slides 식 실시간 동시 편집. 강좌 멤버가 함께 슬라이드 deck을 만듭니다.
        </div>
      </div>

      {canCreate && (
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="새 프리젠테이션 제목 (선택)"
            className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary w-72"
          />
          <button
            onClick={createDeck}
            disabled={creating}
            className="flex items-center gap-1 px-4 py-2 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            <Plus size={14} /> {creating ? "생성 중..." : "새 프리젠테이션"}
          </button>
        </div>
      )}

      {decks.length === 0 ? (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-12 text-center text-caption text-text-tertiary">
          <Presentation size={28} className="mx-auto mb-2 opacity-30" />
          아직 프리젠테이션이 없습니다.
          {canCreate && " 위 [새 프리젠테이션] 버튼으로 만들어보세요."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {decks.map((d) => (
            <Link
              key={d.id}
              href={`/classroom/${cid}/decks/${d.id}`}
              className="group border border-border-default rounded-lg p-4 hover:border-accent hover:shadow-sm transition bg-bg-primary"
            >
              <div className="flex items-start justify-between mb-2">
                <Presentation size={16} className="text-accent flex-shrink-0 mt-0.5" />
                <Pencil size={12} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
              </div>
              <div className="text-body font-medium text-text-primary truncate mb-1">
                {d.title}
              </div>
              <div className="text-caption text-text-tertiary truncate">
                만든이 {d.owner_name || `#${d.owner_id}`} · {d.slide_count}장
              </div>
              <div className="text-[11px] text-text-tertiary mt-2">
                수정 {d.updated_at?.slice(0, 16).replace("T", " ")}
              </div>
            </Link>
          ))}
        </div>
      )}

      {isSuperAdmin && (
        <div className="mt-6 text-[11px] text-text-tertiary border-t border-border-default pt-3">
          (안내) 편집기 + 발표 모드는 Phase P2~P4에서 단계로 진행됩니다. 현재는 deck
          생성·삭제·메타 편집 + 슬라이드 추가/삭제까지 작동합니다.
        </div>
      )}
    </div>
  );
}
