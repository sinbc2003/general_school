"use client";

/**
 * 학생: 이전 학기 보관 강좌 (read-only).
 *
 * 본인이 수강했던 모든 강좌 — 졸업 후에도 본인 활동 증빙 가능.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive } from "lucide-react";
import { api } from "@/lib/api/client";
import { CourseCard } from "@/components/classroom/CourseCard";

interface ArchivedCourse {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  teacher_name?: string;
  is_active: boolean;
  student_count: number;
  semester?: { name: string; year: number; term: number };
}

export default function StudentArchivedClassroomPage() {
  const [courses, setCourses] = useState<ArchivedCourse[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: ArchivedCourse[] }>(
        "/api/classroom/courses/_archived",
      );
      setCourses(data.items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups: Record<string, ArchivedCourse[]> = {};
  for (const c of courses) {
    const key = c.semester
      ? `${c.semester.year}학년도 ${c.semester.term}학기`
      : "학기 정보 없음";
    groups[key] = groups[key] || [];
    groups[key].push(c);
  }
  const keys = Object.keys(groups).sort().reverse();

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/s/classroom"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={12} /> 현재 학기 강좌
        </Link>
        <h1 className="text-title text-text-primary flex items-center gap-2">
          <Archive size={22} /> 이전 학기 강좌
        </h1>
        <p className="text-caption text-text-tertiary mt-1">
          본인이 수강했던 과거 학기 강좌. 읽기 전용 — 자료·과제 내역 열람 가능.
        </p>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : courses.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <Archive size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary mb-1">이전 학기 강좌가 없습니다</div>
        </div>
      ) : (
        <div className="space-y-8">
          {keys.map((k) => (
            <section key={k}>
              <h2 className="text-[15px] font-semibold text-text-secondary mb-3 pb-2 border-b border-border-default">
                {k} <span className="text-caption text-text-tertiary font-normal">· {groups[k].length}개 강좌</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {groups[k].map((c) => (
                  <div key={c.id} className="relative">
                    <CourseCard
                      id={c.id}
                      name={c.name}
                      subject={c.subject}
                      class_name={c.class_name}
                      teacher_name={c.teacher_name}
                      is_active={c.is_active}
                      student_count={c.student_count}
                      baseHref="/s/classroom"
                      showTeacher={true}
                    />
                    <span className="absolute top-2.5 left-2.5 text-[10px] px-2 py-0.5 bg-gray-700/80 text-white rounded inline-flex items-center gap-1 backdrop-blur-sm">
                      <Archive size={9} /> 보관
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
