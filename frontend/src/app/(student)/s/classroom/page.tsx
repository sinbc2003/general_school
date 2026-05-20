"use client";

/**
 * 학생 본인 수업 목록.
 *
 * CourseStudent active 등록된 강좌만 표시.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, Archive } from "lucide-react";
import { api } from "@/lib/api/client";
import { CourseCard } from "@/components/classroom/CourseCard";

interface Course {
  id: number;
  subject: string;
  class_name: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  student_count: number;
}

export default function StudentClassroomPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: Course[] }>("/api/classroom/courses");
      setCourses(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <GraduationCap size={22} /> 내 수업
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            이번 학기 수강 강좌. 클릭하면 클래스룸 (공지·자료)을 볼 수 있습니다.
          </p>
        </div>
        <Link
          href="/s/classroom/archived"
          className="flex items-center gap-1 px-3 py-1.5 text-caption text-text-secondary border border-border-default rounded hover:bg-bg-secondary"
          title="이전 학기에 수강했던 강좌 (읽기 전용)"
        >
          <Archive size={13} /> 이전 학기
        </Link>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : courses.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <GraduationCap size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">
            아직 수강 강좌가 등록되지 않았습니다
          </div>
          <div className="text-caption text-text-tertiary mt-1">
            교사나 관리자가 강좌에 등록해주면 여기 표시됩니다.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {courses.map((c) => (
            <CourseCard
              key={c.id}
              id={c.id}
              name={c.name}
              subject={c.subject}
              class_name={c.class_name}
              is_active={c.is_active !== false}
              student_count={c.student_count}
              baseHref="/s/classroom"
            />
          ))}
        </div>
      )}
    </div>
  );
}
