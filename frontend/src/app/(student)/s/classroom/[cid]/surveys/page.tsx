"use client";

/**
 * 학생용 강좌 설문 목록.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardList, Unlock, Archive } from "lucide-react";
import { api } from "@/lib/api/client";

interface CourseDetail {
  id: number;
  name: string;
}

interface SurveyItem {
  id: number;
  title: string;
  description: string | null;
  status: "draft" | "active" | "closed";
  is_anonymous: boolean;
  author_name?: string;
}

export default function StudentSurveysPage() {
  const params = useParams();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get<CourseDetail>(`/api/classroom/courses/${cid}`),
        api.get<{ items: SurveyItem[] }>(`/api/classroom/surveys?course_id=${cid}`),
      ]);
      setCourse(c);
      // 학생에게는 draft는 숨김
      setSurveys(s.items.filter((x) => x.status !== "draft"));
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
          <ClipboardList size={20} /> 설문
        </h1>
      </div>

      {surveys.length === 0 ? (
        <div className="text-caption text-text-tertiary py-12 text-center border border-dashed border-border-default rounded">
          참여 가능한 설문이 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {surveys.map((s) => (
            <Link
              key={s.id}
              href={`/s/classroom/${cid}/surveys/${s.id}`}
              className="group border border-border-default rounded-lg p-4 hover:border-accent hover:shadow-sm transition bg-bg-primary"
            >
              <div className="flex items-start justify-between mb-2">
                <ClipboardList size={16} className="text-accent flex-shrink-0 mt-0.5" />
                {s.status === "active" ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 inline-flex items-center gap-0.5">
                    <Unlock size={9} /> 응답 가능
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-0.5">
                    <Archive size={9} /> 마감
                  </span>
                )}
              </div>
              <div className="text-body font-medium text-text-primary truncate mb-1">
                {s.title}
              </div>
              {s.description && (
                <div className="text-caption text-text-tertiary truncate">{s.description}</div>
              )}
              <div className="text-[11px] text-text-tertiary mt-2">
                {s.author_name && `만든이 ${s.author_name}`}
                {s.is_anonymous && " · 익명 응답"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
