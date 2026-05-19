"use client";

/**
 * 학생 본인 수업 목록.
 *
 * CourseStudent active 등록된 강좌만 표시.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, Users } from "lucide-react";
import { api } from "@/lib/api/client";

interface Course {
  id: number;
  subject: string;
  class_name: string | null;
  name: string;
  description: string | null;
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
      <div className="mb-6">
        <h1 className="text-title text-text-primary flex items-center gap-2">
          <GraduationCap size={22} /> 내 수업
        </h1>
        <p className="text-caption text-text-tertiary mt-1">
          이번 학기 수강 강좌. 클릭하면 클래스룸 (공지·자료)을 볼 수 있습니다.
        </p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/s/classroom/${c.id}`}
              className="bg-bg-primary border border-border-default rounded-lg p-4 hover:border-accent transition-colors"
            >
              <div className="text-body font-semibold text-text-primary mb-2 truncate">
                {c.name}
              </div>
              <div className="text-caption text-text-secondary mb-2">
                {c.subject} {c.class_name && `· ${c.class_name}`}
              </div>
              {c.description && (
                <div className="text-caption text-text-tertiary line-clamp-2 mb-2">
                  {c.description}
                </div>
              )}
              <div className="text-caption text-text-tertiary flex items-center gap-1">
                <Users size={12} /> {c.student_count}명 수강
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
