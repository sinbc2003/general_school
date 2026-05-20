"use client";

/**
 * 클래스룸 메인 그룹화 뷰 — 년도·학기별 + 즐겨찾기 + 검색·필터.
 *
 * 표시 순서:
 *  1. 즐겨찾기 (⭐) — 별도 섹션, 항상 펼침
 *  2. 현재 학기 (펼침)
 *  3. 과거 학기들 (기본 접힘, 토글로 펼침)
 *
 * 그룹화 키: 학기 (semester_id). 학기 안에서 타입(subject/grade_office/class_homeroom) 정렬.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Star, X } from "lucide-react";
import { CourseCard } from "@/components/classroom/CourseCard";
import { api } from "@/lib/api/client";

interface Course {
  id: number;
  semester_id: number;
  teacher_id: number;
  teacher_name?: string;
  subject: string;
  class_name: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  student_count: number;
  created_at: string | null;
  course_type?: string;
  banner_color?: string;
  banner_image_url?: string | null;
  icon?: string | null;
  grade_level?: number | null;
}

interface Semester {
  id: number;
  name: string;
  year: number;
  semester: number;
  is_current: boolean;
  is_archived: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  subject: "교과",
  grade_office: "학년부",
  class_homeroom: "학급",
};

const TYPE_ORDER = ["grade_office", "class_homeroom", "subject"];

export function CourseGroupedView({
  courses,
  baseHref,
  showTeacher = false,
}: {
  courses: Course[];
  baseHref: string;
  showTeacher?: boolean;
}) {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [expandedSemesters, setExpandedSemesters] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const loadAux = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        api.get<any>("/api/timetable/semesters"),
        api.get<{ course_ids: number[] }>("/api/classroom/favorites").catch(() => ({ course_ids: [] })),
      ]);
      const list = Array.isArray(s) ? s : s.items || [];
      setSemesters(list);
      setFavorites(new Set(f.course_ids));
      const current = list.find((x: Semester) => x.is_current);
      if (current) {
        try {
          const saved = sessionStorage.getItem("classroom.expanded.semesters");
          if (saved) {
            setExpandedSemesters(new Set(JSON.parse(saved)));
          } else {
            setExpandedSemesters(new Set([current.id]));
          }
        } catch {
          setExpandedSemesters(new Set([current.id]));
        }
      }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadAux(); }, [loadAux]);

  const toggleSemester = (sid: number) => {
    setExpandedSemesters((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      try { sessionStorage.setItem("classroom.expanded.semesters", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const toggleFavorite = async (cid: number) => {
    try {
      if (favorites.has(cid)) {
        await api.delete(`/api/classroom/courses/${cid}/favorite`);
        setFavorites((prev) => { const next = new Set(prev); next.delete(cid); return next; });
      } else {
        await api.post(`/api/classroom/courses/${cid}/favorite`, {});
        setFavorites((prev) => {
          const next = new Set<number>();
          prev.forEach((v) => next.add(v));
          next.add(cid);
          return next;
        });
      }
    } catch {}
  };

  // 필터 + 검색
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((c) => {
      if (typeFilter !== "all" && (c.course_type || "subject") !== typeFilter) return false;
      if (q) {
        const hay = [c.name, c.subject, c.class_name, c.teacher_name].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [courses, search, typeFilter]);

  // 즐겨찾기 강좌
  const favList = filtered.filter((c) => favorites.has(c.id));

  // 학기별 그룹화 (즐겨찾기에 있는 것은 그대로 학기에도 표시)
  const grouped = useMemo(() => {
    const m: Record<number, Course[]> = {};
    for (const c of filtered) {
      if (!m[c.semester_id]) m[c.semester_id] = [];
      m[c.semester_id].push(c);
    }
    for (const sid in m) {
      m[sid].sort((a, b) => {
        const aType = a.course_type || "subject";
        const bType = b.course_type || "subject";
        const aIdx = TYPE_ORDER.indexOf(aType);
        const bIdx = TYPE_ORDER.indexOf(bType);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.name.localeCompare(b.name);
      });
    }
    return m;
  }, [filtered]);

  // 학기 정렬: 현재 > 미래 > 과거(년도 desc + 학기 desc)
  const sortedSemesters = useMemo(() => {
    return [...semesters]
      .filter((s) => grouped[s.id]?.length)
      .sort((a, b) => {
        if (a.is_current && !b.is_current) return -1;
        if (!a.is_current && b.is_current) return 1;
        if (a.year !== b.year) return b.year - a.year;
        return b.semester - a.semester;
      });
  }, [semesters, grouped]);

  const renderCard = (c: Course) => (
    <div key={c.id} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggleFavorite(c.id); }}
        className="absolute top-2 right-2 z-10 p-1 rounded bg-bg-primary/80 backdrop-blur hover:bg-bg-primary"
        title={favorites.has(c.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      >
        <Star
          size={14}
          className={favorites.has(c.id) ? "text-yellow-500 fill-yellow-400" : "text-text-tertiary"}
        />
      </button>
      <CourseCard
        id={c.id}
        name={c.name}
        subject={c.subject}
        class_name={c.class_name}
        teacher_name={c.teacher_name}
        is_active={c.is_active}
        student_count={c.student_count}
        baseHref={baseHref}
        showTeacher={showTeacher}
        bannerColor={c.banner_color}
        bannerImageUrl={c.banner_image_url}
        icon={c.icon}
        courseType={c.course_type}
      />
    </div>
  );

  return (
    <div>
      {/* 검색 + 필터 */}
      <div className="flex items-center gap-2 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="강좌명·과목·교사 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-[13px] border border-border-default rounded-md bg-bg-primary"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-[13px] border border-border-default rounded-md bg-bg-primary"
        >
          <option value="all">전체 타입</option>
          <option value="subject">교과</option>
          <option value="grade_office">학년부</option>
          <option value="class_homeroom">학급</option>
        </select>
      </div>

      {/* 즐겨찾기 섹션 */}
      {favList.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Star size={14} className="text-yellow-500 fill-yellow-400" />
            <h2 className="text-body font-semibold text-text-primary">즐겨찾기</h2>
            <span className="text-[11px] text-text-tertiary">({favList.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {favList.map(renderCard)}
          </div>
        </div>
      )}

      {/* 학기별 섹션 */}
      {sortedSemesters.map((sem) => {
        const list = grouped[sem.id] || [];
        const isExpanded = expandedSemesters.has(sem.id);
        return (
          <div key={sem.id} className="mb-5">
            <button
              type="button"
              onClick={() => toggleSemester(sem.id)}
              className="w-full flex items-center gap-2 mb-3 group"
            >
              {isExpanded ? <ChevronDown size={16} className="text-text-secondary" /> : <ChevronRight size={16} className="text-text-secondary" />}
              <h2 className="text-body font-semibold text-text-primary group-hover:text-accent">
                {sem.name}
              </h2>
              <span className="text-[11px] text-text-tertiary">({list.length})</span>
              {sem.is_current && (
                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">현재</span>
              )}
              {sem.is_archived && (
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">보관</span>
              )}
            </button>
            {isExpanded && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {list.map(renderCard)}
              </div>
            )}
          </div>
        );
      })}

      {/* 학기에 없는 강좌 (semester가 없는 경우) */}
      {(() => {
        const orphans = filtered.filter((c) => !semesters.find((s) => s.id === c.semester_id));
        if (orphans.length === 0) return null;
        return (
          <div className="mb-5">
            <h2 className="text-body font-semibold text-text-secondary mb-3">기타</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {orphans.map(renderCard)}
            </div>
          </div>
        );
      })()}

      {sortedSemesters.length === 0 && favList.length === 0 && (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <div className="text-body text-text-tertiary">검색 결과 없음</div>
        </div>
      )}
    </div>
  );
}
