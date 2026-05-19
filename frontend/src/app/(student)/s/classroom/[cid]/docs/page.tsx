"use client";

/**
 * 학생용 강좌 협업 문서 목록.
 *
 * 학생은 새 문서 생성 X (교사·관리자만). 멤버로 등록된 문서만 보임.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, Pencil } from "lucide-react";
import { api } from "@/lib/api/client";

interface DocItem {
  id: number;
  title: string;
  owner_name?: string;
  owner_id: number;
  access_mode: string;
  is_archived: boolean;
  updated_at: string | null;
}

interface CourseDetail {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
}

export default function StudentCourseDocsPage() {
  const params = useParams();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, d] = await Promise.all([
        api.get<CourseDetail>(`/api/classroom/courses/${cid}`),
        api.get<{ items: DocItem[] }>(`/api/classroom/docs?course_id=${cid}`),
      ]);
      setCourse(c);
      setDocs(d.items);
    } catch (e: any) {
      alert(e?.detail || "조회 실패");
    } finally {
      setLoading(false);
    }
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
          <FileText size={20} /> 협업 문서
        </h1>
        <div className="text-caption text-text-tertiary mt-1">
          이 강좌에서 함께 작성하는 문서입니다. 클릭하면 실시간 편집 가능.
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="text-caption text-text-tertiary py-12 text-center border border-dashed border-border-default rounded">
          아직 협업 문서가 없습니다. 선생님이 문서를 만들면 여기에 나타납니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map((d) => (
            <Link
              key={d.id}
              href={`/s/classroom/${cid}/docs/${d.id}`}
              className="group border border-border-default rounded-lg p-4 hover:border-accent hover:shadow-sm transition bg-bg-primary"
            >
              <div className="flex items-start justify-between mb-2">
                <FileText size={16} className="text-accent flex-shrink-0 mt-0.5" />
                <Pencil size={12} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
              </div>
              <div className="text-body font-medium text-text-primary truncate mb-1">
                {d.title}
              </div>
              <div className="text-caption text-text-tertiary truncate">
                만든이 {d.owner_name || `#${d.owner_id}`}
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
