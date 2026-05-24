"use client";

/**
 * 코스웨어 모아보기 — 강좌 무관 본인 관련 ProblemSet 전체.
 *
 * variant:
 *  - admin   : 본인이 가르치는 강좌 + 출제 모달 진입 (강좌 select)
 *  - student : 본인 수강 강좌 + 풀이 진입 (게시된 세트만)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileQuestion, Plus, Clock, CheckCircle2, PenLine, Trash2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { ProblemSetCreateModal } from "./ProblemSetCreateModal";
import type { ProblemSetSummary } from "./types";
import { STATUS_LABEL, STATUS_BADGE_TONE } from "./types";

interface CourseGroup {
  course_id: number;
  course_name: string;
  subject: string | null;
  class_name: string | null;
  semester: { id: number; year: number; term: number; name: string } | null;
  is_active: boolean;
  sets: ProblemSetSummary[];
}

interface Props {
  variant: "admin" | "student";
}

export function MyCoursewareView({ variant }: Props) {
  const toast = useToast();
  const [courses, setCourses] = useState<CourseGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [createForCid, setCreateForCid] = useState<number | null>(null);
  const [filterSemesterKey, setFilterSemesterKey] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ courses: CourseGroup[] }>(
        `/api/courseware/my-problem-sets`,
      );
      setCourses(res.courses);
    } catch (e: any) {
      toast.show(e?.detail || "조회 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // 학기 필터 옵션
  const semesterOptions = useMemo(() => {
    const set = new Map<string, string>();
    courses.forEach((c) => {
      if (c.semester) {
        const key = `${c.semester.year}-${c.semester.term}`;
        set.set(key, `${c.semester.year}학년도 ${c.semester.term}학기`);
      }
    });
    return Array.from(set.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [courses]);

  const filtered = useMemo(() => {
    if (filterSemesterKey === "all") return courses;
    return courses.filter(
      (c) =>
        c.semester &&
        `${c.semester.year}-${c.semester.term}` === filterSemesterKey,
    );
  }, [courses, filterSemesterKey]);

  const totalSets = filtered.reduce((sum, c) => sum + c.sets.length, 0);

  const handlePublish = async (psid: number) => {
    try {
      await api.post(`/api/courseware/problem-sets/${psid}/publish`);
      toast.show("게시됨", "success");
      load();
    } catch (e: any) { toast.show(e?.detail || "실패", "error"); }
  };

  const handleClose = async (psid: number) => {
    if (!confirm("마감 후엔 학생이 제출할 수 없습니다.")) return;
    try {
      await api.post(`/api/courseware/problem-sets/${psid}/close`);
      toast.show("마감됨", "success");
      load();
    } catch (e: any) { toast.show(e?.detail || "실패", "error"); }
  };

  const handleDelete = async (psid: number) => {
    if (!confirm("이 문제 세트를 휴지통으로 보냅니다.")) return;
    try {
      await api.delete(`/api/courseware/problem-sets/${psid}`);
      toast.show("삭제됨", "success");
      load();
    } catch (e: any) { toast.show(e?.detail || "실패", "error"); }
  };

  const detailHref = (cid: number, psid: number) =>
    variant === "admin"
      ? `/classroom/${cid}/courseware/${psid}`
      : `/s/classroom/${cid}/courseware/${psid}`;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 flex items-center gap-2">
            <FileQuestion size={22} /> {variant === "admin" ? "코스웨어" : "문제 풀이"}
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            {variant === "admin"
              ? "본인이 가르치는 모든 강좌의 문제 세트 — 강좌 무관 통합 관리."
              : "수강 중인 강좌의 게시된 문제 세트 — 풀이·결과 확인."}
          </p>
        </div>
        {variant === "admin" && courses.length > 0 && (
          <button
            type="button"
            onClick={() => setCreateForCid(courses[0].course_id)}
            className="px-3 py-1.5 text-caption bg-accent-default text-white rounded hover:opacity-90 flex items-center gap-1 shrink-0"
          >
            <Plus size={14} /> 문제 세트 출제
          </button>
        )}
      </div>

      {/* 학기 필터 */}
      {semesterOptions.length > 1 && (
        <div className="flex items-center gap-2 text-caption">
          <select
            value={filterSemesterKey}
            onChange={(e) => setFilterSemesterKey(e.target.value)}
            className="px-2 py-1.5 border border-border-default rounded text-body"
          >
            <option value="all">학기 전체</option>
            {semesterOptions.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <span className="text-text-tertiary">
            {filtered.length}개 강좌 · {totalSets}개 세트
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-text-tertiary text-center py-8">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <EmptyState variant={variant} />
      ) : (
        <div className="space-y-4">
          {filtered.map((c) => (
            <CourseGroupCard
              key={c.course_id}
              group={c}
              variant={variant}
              detailHref={detailHref}
              onCreate={() => setCreateForCid(c.course_id)}
              onPublish={handlePublish}
              onClose={handleClose}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {createForCid !== null && variant === "admin" && (
        <ProblemSetCreateModal
          cid={createForCid}
          allowCourseSelect={true}
          courseOptions={courses.map((c) => ({
            id: c.course_id,
            name: c.course_name,
            class_name: c.class_name,
            semester: c.semester,
          }))}
          onClose={() => setCreateForCid(null)}
          onCreated={() => { setCreateForCid(null); load(); }}
        />
      )}
    </div>
  );
}


function EmptyState({ variant }: { variant: "admin" | "student" }) {
  return (
    <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 text-center">
      <FileQuestion size={32} className="mx-auto text-text-tertiary opacity-30 mb-3" />
      <div className="text-body text-text-secondary mb-1">
        {variant === "admin" ? "출제한 문제 세트가 없습니다" : "아직 풀어볼 문제가 없습니다"}
      </div>
      <div className="text-caption text-text-tertiary">
        {variant === "admin"
          ? "오른쪽 위 '문제 세트 출제' 버튼으로 시작하세요"
          : "교사가 문제를 게시하면 여기 표시됩니다"}
      </div>
    </div>
  );
}


interface CourseGroupCardProps {
  group: CourseGroup;
  variant: "admin" | "student";
  detailHref: (cid: number, psid: number) => string;
  onCreate: () => void;
  onPublish: (psid: number) => void;
  onClose: (psid: number) => void;
  onDelete: (psid: number) => void;
}

function CourseGroupCard({
  group, variant, detailHref, onCreate, onPublish, onClose, onDelete,
}: CourseGroupCardProps) {
  return (
    <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-bg-secondary border-b border-border-default">
        <div className="flex-1 min-w-0">
          <Link
            href={
              variant === "admin"
                ? `/classroom/${group.course_id}`
                : `/s/classroom/${group.course_id}`
            }
            className="text-body font-semibold text-text-primary hover:underline"
          >
            {group.course_name}
          </Link>
          <div className="flex items-center gap-1.5 text-caption text-text-tertiary mt-0.5">
            {group.semester && (
              <span>
                {group.semester.year}학년도 {group.semester.term}학기
              </span>
            )}
            {group.class_name && <span>· {group.class_name}</span>}
            {group.subject && <span>· {group.subject}</span>}
            {!group.is_active && (
              <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px]">
                비활성
              </span>
            )}
          </div>
        </div>
        {variant === "admin" && (
          <button
            type="button"
            onClick={onCreate}
            className="text-caption px-2 py-1 border border-border-default rounded hover:bg-bg-primary flex items-center gap-1"
          >
            <Plus size={11} /> 출제
          </button>
        )}
      </div>

      <div className="divide-y divide-border-default">
        {group.sets.length === 0 ? (
          <div className="py-6 text-center text-caption text-text-tertiary">
            문제 세트 없음
          </div>
        ) : (
          group.sets.map((ps) => (
            <ProblemSetRow
              key={ps.id}
              ps={ps}
              variant={variant}
              detailHref={detailHref(group.course_id, ps.id)}
              onPublish={() => onPublish(ps.id)}
              onClose={() => onClose(ps.id)}
              onDelete={() => onDelete(ps.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}


interface ProblemSetRowProps {
  ps: ProblemSetSummary;
  variant: "admin" | "student";
  detailHref: string;
  onPublish: () => void;
  onClose: () => void;
  onDelete: () => void;
}

function ProblemSetRow({
  ps, variant, detailHref, onPublish, onClose, onDelete,
}: ProblemSetRowProps) {
  const dueText = ps.due_date
    ? new Date(ps.due_date).toLocaleString("ko-KR", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      })
    : "기한 없음";
  return (
    <div className="px-4 py-3 hover:bg-bg-secondary transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Link
              href={detailHref}
              className="text-body font-medium text-text-primary hover:underline"
            >
              {ps.title}
            </Link>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE_TONE[ps.status]}`}>
              {STATUS_LABEL[ps.status]}
            </span>
          </div>
          {ps.description && (
            <div className="text-caption text-text-secondary mb-1 line-clamp-1">
              {ps.description}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-caption text-text-tertiary">
            <span className="flex items-center gap-1">
              <FileQuestion size={12} /> {ps.problem_count}문제
            </span>
            <span className="flex items-center gap-1">
              <Clock size={12} /> {dueText}
            </span>
            <span>재응시 {ps.max_attempts}회</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {variant === "admin" && (
            <>
              {ps.status === "draft" && (
                <button
                  type="button"
                  onClick={onPublish}
                  className="text-caption px-2 py-1 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50"
                >
                  게시
                </button>
              )}
              {ps.status === "published" && (
                <button
                  type="button"
                  onClick={onClose}
                  className="text-caption px-2 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
                >
                  마감
                </button>
              )}
              <Link
                href={detailHref}
                className="text-text-tertiary hover:text-text-primary p-1"
                aria-label="편집"
              >
                <PenLine size={14} />
              </Link>
              <button
                type="button"
                onClick={onDelete}
                className="text-text-tertiary hover:text-red-600 p-1"
                aria-label="삭제"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          {variant === "student" && (
            <Link
              href={detailHref}
              className="text-caption px-3 py-1 bg-accent-default text-white rounded hover:opacity-90 flex items-center gap-1"
            >
              <CheckCircle2 size={12} /> 풀이
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
