"use client";

/**
 * 학생용 강좌 프리젠테이션 deck 목록.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Presentation, Pencil } from "lucide-react";
import { api } from "@/lib/api/client";

interface DeckItem {
  id: number;
  title: string;
  owner_name?: string;
  owner_id: number;
  slide_count: number;
  is_archived: boolean;
  updated_at: string | null;
}

interface CourseDetail {
  id: number;
  name: string;
}

export default function StudentCourseDecksPage() {
  const params = useParams();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [decks, setDecks] = useState<DeckItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, d] = await Promise.all([
        api.get<CourseDetail>(`/api/classroom/courses/${cid}`),
        api.get<{ items: DeckItem[] }>(`/api/classroom/decks?course_id=${cid}`),
      ]);
      setCourse(c);
      setDecks(d.items);
    } catch {} finally { setLoading(false); }
  }, [cid]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!course) return null;

  return (
    <div>
      <div className="mb-4">
        <Link
          href={`/s/classroom/${cid}`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> {course.name}
        </Link>
        <h1 className="text-title text-text-primary mt-1 flex items-center gap-2">
          <Presentation size={20} /> 프리젠테이션
        </h1>
        <div className="text-caption text-text-tertiary mt-1">
          이 강좌의 프리젠테이션. 클릭하면 실시간 편집·발표 모드.
        </div>
      </div>

      {decks.length === 0 ? (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-12 text-center text-caption text-text-tertiary">
          <Presentation size={28} className="mx-auto mb-2 opacity-30" />
          아직 프리젠테이션이 없습니다
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {decks.map((d) => (
            <Link
              key={d.id}
              href={`/s/classroom/${cid}/decks/${d.id}`}
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
    </div>
  );
}
