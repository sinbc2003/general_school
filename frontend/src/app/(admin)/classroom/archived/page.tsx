"use client";

/**
 * 이전 학기 보관 강좌 (read-only) — Google Classroom의 "보관된 강좌" 메뉴.
 *
 * 본인 관련만:
 *   - 교사: 본인이 가르쳤던 강좌 모두
 *   - 학생: 본인이 수강했던 강좌 모두 (status 무관 — 졸업·전학 학생도 본인 데이터)
 *   - admin: 모든 과거 학기 강좌
 *
 * 클릭 시 강좌 상세로 — 상세 페이지가 is_past_semester 플래그로 read-only 자동 처리.
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

export default function ArchivedClassroomPage() {
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

  // 학기별 그룹화 — "2025-1학기" "2024-2학기" 등 묶음
  const groups: Record<string, ArchivedCourse[]> = {};
  for (const c of courses) {
    const key = c.semester
      ? `${c.semester.year}학년도 ${c.semester.term}학기`
      : "학기 정보 없음";
    groups[key] = groups[key] || [];
    groups[key].push(c);
  }
  // 최신 학기 먼저
  const keys = Object.keys(groups).sort().reverse();

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/classroom"
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={12} /> 현재 학기 강좌
        </Link>
        <h1 className="text-title text-text-primary flex items-center gap-2">
          <Archive size={22} /> 이전 학기 보관 강좌
        </h1>
        <p className="text-caption text-text-tertiary mt-1">
          본인이 가르쳤거나 수강했던 과거 학기 강좌. 읽기 전용 — 새 글 작성·편집 불가.
          자료 재사용은 현재 학기 강좌에서 "복제" 메뉴로 가능합니다.
        </p>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : courses.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <Archive size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary mb-1">보관된 강좌가 없습니다</div>
          <div className="text-caption text-text-tertiary">
            이전 학기 강좌가 있으면 여기 표시됩니다.
          </div>
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
                      baseHref="/classroom"
                      showTeacher={true}
                    />
                    {/* read-only 배지 */}
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
