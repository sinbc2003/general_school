"use client";

/**
 * 코스웨어 메인 — 학생·교사 통합 (variant prop).
 *
 *  - 4박스 통계 패널
 *  - 학생: 🎯 오늘의 학습 hero + 🔥 주 단위 streak
 *  - 교사: 출제·게시·평균·needs_review (검토 우선)
 *  - 강좌별 그룹 카드 + ProblemSetCard 강화 (좌 도넛 / 우 정보)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileQuestion, Plus, Clock, CheckCircle2, PenLine, Trash2,
  Flame, Target, Bot, BookOpen, TrendingUp, ArrowRight, Sparkles,
  AlertTriangle, Award,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import { ProblemSetCreateModal } from "./ProblemSetCreateModal";
import { CircularProgress, StatBox, AccuracyBadge } from "./_widgets";
import type { ProblemSetSummary } from "./types";
import { STATUS_LABEL, STATUS_BADGE_TONE } from "./types";


// ── 응답 타입 ────────────────────────────────────────────────────────────────

interface SetStatsStudent {
  best_score?: number;
  attempts_used?: number;
  last_submitted_at?: string | null;
  graded_count?: number;
  total_count?: number;
}

interface SetStatsTeacher {
  submissions_count?: number;
  avg_score?: number;
  needs_review_count?: number;
}

type SetStats = SetStatsStudent & SetStatsTeacher;

interface ProblemSetWithStats extends ProblemSetSummary {
  stats?: SetStats;
}

interface CourseGroup {
  course_id: number;
  course_name: string;
  subject: string | null;
  class_name: string | null;
  semester: { id: number; year: number; term: number; name: string } | null;
  is_active: boolean;
  sets: ProblemSetWithStats[];
}

interface StudentDashboard {
  total_attempts: number;
  distinct_problems: number;
  auto_accuracy: number;
  avg_score: number;
  streak_this_week: number;
  today_card: {
    problem_set_id: number;
    course_id: number;
    title: string;
    description: string | null;
    problem_count: number;
    due_date: string | null;
    max_attempts: number;
    reason: string;
  } | null;
}

interface TeacherDashboard {
  total_sets: number;
  published_sets: number;
  total_attempts: number;
  auto_accuracy: number;
  needs_review_count: number;
  failed_count: number;
}


// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return d.toLocaleDateString("ko-KR");
}

function fmtDue(iso: string | null): { text: string; tone: "default" | "urgent" | "soon" | "past" } {
  if (!iso) return { text: "기한 없음", tone: "default" };
  const d = new Date(iso);
  const diff = (d.getTime() - Date.now()) / 1000;
  const fmt = d.toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  if (diff < 0) return { text: `마감됨 (${fmt})`, tone: "past" };
  if (diff < 3600 * 24) return { text: `D-1 (${fmt})`, tone: "urgent" };
  if (diff < 3600 * 24 * 3) return { text: `D-${Math.ceil(diff / 86400)} (${fmt})`, tone: "soon" };
  return { text: fmt, tone: "default" };
}


// ── 메인 ─────────────────────────────────────────────────────────────────────

interface Props {
  variant: "admin" | "student";
}

export function MyCoursewareView({ variant }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [courses, setCourses] = useState<CourseGroup[]>([]);
  const [studentDash, setStudentDash] = useState<StudentDashboard | null>(null);
  const [teacherDash, setTeacherDash] = useState<TeacherDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [createForCid, setCreateForCid] = useState<number | null>(null);
  const [filterSemesterKey, setFilterSemesterKey] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRes, dashRes] = await Promise.all([
        api.get<{ courses: CourseGroup[] }>(`/api/courseware/my-problem-sets`),
        variant === "student"
          ? api.get<StudentDashboard>(`/api/courseware/me/dashboard`)
          : api.get<TeacherDashboard>(`/api/courseware/teacher/dashboard`),
      ]);
      setCourses(courseRes.courses);
      if (variant === "student") setStudentDash(dashRes as StudentDashboard);
      else setTeacherDash(dashRes as TeacherDashboard);
    } catch (e: any) {
      toast.show(e?.detail || "조회 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [variant, toast]);

  useEffect(() => { load(); }, [load]);

  // 학기 필터
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
      (c) => c.semester && `${c.semester.year}-${c.semester.term}` === filterSemesterKey,
    );
  }, [courses, filterSemesterKey]);

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

  const handleSeedDemo = async () => {
    if (!confirm("데모 데이터를 생성합니다 (Problem 10개 + 세트 3개 + 학생 attempt 다양성). 진행할까요?")) return;
    setSeedingDemo(true);
    try {
      const res = await api.post<{
        course_name: string;
        problems_created: number;
        sets_created: number;
        attempts_created: number;
        student_count: number;
        skipped_reason?: string;
      }>(`/api/courseware/_demo/seed`);
      if (res.skipped_reason) {
        toast.show(`Skip: ${res.skipped_reason}`, "info");
      } else {
        toast.show(
          `데모 생성 — ${res.course_name}: 문제 ${res.problems_created} · ` +
          `세트 ${res.sets_created} · attempt ${res.attempts_created} (학생 ${res.student_count}명)`,
          "success",
        );
      }
      load();
    } catch (e: any) {
      toast.show(e?.detail || "데모 생성 실패", "error");
    } finally {
      setSeedingDemo(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 flex items-center gap-2">
            <FileQuestion size={22} className="text-accent-default" />
            {variant === "admin" ? "코스웨어" : "문제 풀이"}
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            {variant === "admin"
              ? "본인 강좌의 문제 세트 통합 관리 — 출제·게시·결과 분석"
              : "수강 강좌의 문제 — 풀이·점수·약점 확인"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {variant === "admin" && isSuperAdmin && (
            <button
              type="button"
              onClick={handleSeedDemo}
              disabled={seedingDemo}
              className="px-3 py-2 text-caption border border-dashed border-cream-300 text-text-secondary rounded-lg hover:bg-cream-50 disabled:opacity-50 flex items-center gap-1.5"
              title="개발용 — 데모 데이터 생성 (멱등)"
            >
              <Sparkles size={14} className="text-amber-500" />
              {seedingDemo ? "생성 중..." : "데모 데이터"}
            </button>
          )}
          {variant === "admin" && courses.length > 0 && (
            <button
              type="button"
              onClick={() => setCreateForCid(courses[0].course_id)}
              className="px-3 py-2 text-caption bg-accent-default text-white rounded-lg hover:opacity-90 flex items-center gap-1.5 shadow-sm"
            >
              <Plus size={14} /> 문제 세트 출제
            </button>
          )}
        </div>
      </div>

      {/* 통계 패널 */}
      {variant === "student" && studentDash && (
        <StudentStats dash={studentDash} />
      )}
      {variant === "admin" && teacherDash && (
        <TeacherStats dash={teacherDash} />
      )}

      {/* 오늘의 학습 (학생) */}
      {variant === "student" && studentDash?.today_card && (
        <TodayLearningHero card={studentDash.today_card} />
      )}

      {/* 학기 필터 */}
      {semesterOptions.length > 1 && (
        <div className="flex items-center gap-2 text-caption">
          <select
            value={filterSemesterKey}
            onChange={(e) => setFilterSemesterKey(e.target.value)}
            className="px-2 py-1.5 border border-border-default rounded text-body bg-bg-primary"
          >
            <option value="all">학기 전체</option>
            {semesterOptions.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <span className="text-text-tertiary">
            {filtered.length}개 강좌 · {filtered.reduce((s, c) => s + c.sets.length, 0)}개 세트
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


// ── 통계 패널 ────────────────────────────────────────────────────────────────

function StudentStats({ dash }: { dash: StudentDashboard }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatBox
        icon={BookOpen}
        label="푼 문제"
        value={dash.distinct_problems}
        subText={`총 ${dash.total_attempts}회 시도`}
      />
      <StatBox
        icon={TrendingUp}
        label="정답률"
        value={`${Math.round(dash.auto_accuracy * 100)}%`}
        subText="자동채점 기준"
        tone={dash.auto_accuracy >= 0.8 ? "emerald" : dash.auto_accuracy >= 0.5 ? "amber" : "red"}
      />
      <StatBox
        icon={Award}
        label="평균 점수"
        value={dash.avg_score.toFixed(2)}
        subText="세트별 최고점 평균 (0~1)"
        tone={dash.avg_score >= 0.8 ? "emerald" : dash.avg_score >= 0.5 ? "amber" : "default"}
      />
      <StatBox
        icon={Flame}
        label="이번 주 학습"
        value={`${dash.streak_this_week}/7일`}
        subText="월~일 누적"
        tone={dash.streak_this_week >= 5 ? "amber" : "cream"}
      />
    </div>
  );
}

function TeacherStats({ dash }: { dash: TeacherDashboard }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatBox
        icon={FileQuestion}
        label="출제 세트"
        value={dash.total_sets}
        subText={`게시 중 ${dash.published_sets}개`}
      />
      <StatBox
        icon={BookOpen}
        label="학생 시도"
        value={dash.total_attempts}
        subText="누적 attempt"
      />
      <StatBox
        icon={TrendingUp}
        label="평균 정답률"
        value={`${Math.round(dash.auto_accuracy * 100)}%`}
        subText="자동채점 기준"
        tone={dash.auto_accuracy >= 0.7 ? "emerald" : dash.auto_accuracy >= 0.5 ? "amber" : "red"}
      />
      <StatBox
        icon={Bot}
        label="AI 검토 필요"
        value={dash.needs_review_count + (dash.failed_count > 0 ? ` (실패 ${dash.failed_count})` : "")}
        subText={dash.needs_review_count > 0 ? "신뢰도 낮은 채점" : "모두 신뢰도 OK"}
        tone={dash.needs_review_count > 0 ? "amber" : dash.failed_count > 0 ? "red" : "emerald"}
      />
    </div>
  );
}


// ── Today's learning hero (학생) ────────────────────────────────────────────

function TodayLearningHero({
  card,
}: {
  card: NonNullable<StudentDashboard["today_card"]>;
}) {
  const due = fmtDue(card.due_date);
  return (
    <Link
      href={`/s/classroom/${card.course_id}/courseware/${card.problem_set_id}`}
      className="block bg-gradient-to-br from-accent-default/10 via-cream-50 to-sky-50 border border-cream-300 rounded-xl p-5 hover:shadow-md transition group"
    >
      <div className="flex items-center gap-2 text-caption text-text-secondary mb-2">
        <Target size={14} className="text-accent-default" />
        <span className="font-semibold">오늘의 학습</span>
        <span className="text-text-tertiary">· {card.reason}</span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-h2 font-semibold text-text-primary truncate">
            {card.title}
          </h2>
          {card.description && (
            <p className="text-caption text-text-secondary mt-1 line-clamp-1">
              {card.description}
            </p>
          )}
          <div className="flex items-center gap-3 text-caption text-text-tertiary mt-2">
            <span className="flex items-center gap-1">
              <FileQuestion size={12} /> {card.problem_count}문제
            </span>
            <span className={`flex items-center gap-1 ${
              due.tone === "urgent" ? "text-red-700 font-semibold" :
              due.tone === "soon" ? "text-amber-700" : ""
            }`}>
              <Clock size={12} /> {due.text}
            </span>
            <span>재응시 {card.max_attempts}회</span>
          </div>
        </div>
        <div className="shrink-0 self-center bg-accent-default text-white px-4 py-2 rounded-lg text-caption flex items-center gap-1 group-hover:translate-x-0.5 transition">
          지금 풀기 <ArrowRight size={14} />
        </div>
      </div>
    </Link>
  );
}


// ── EmptyState ──────────────────────────────────────────────────────────────

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


// ── CourseGroupCard ──────────────────────────────────────────────────────────

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
    <div className="bg-bg-primary border border-border-default rounded-xl overflow-hidden shadow-sm hover:shadow transition">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-bg-secondary border-b border-border-default">
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
          <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary mt-0.5">
            {group.semester && (
              <span>{group.semester.year}학년도 {group.semester.term}학기</span>
            )}
            {group.class_name && <span>· {group.class_name}</span>}
            {group.subject && <span>· {group.subject}</span>}
            <span className="text-text-tertiary">· {group.sets.length}개 세트</span>
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

      {group.sets.length === 0 ? (
        <div className="py-6 text-center text-caption text-text-tertiary">
          문제 세트 없음
        </div>
      ) : (
        <div className="divide-y divide-border-default">
          {group.sets.map((ps) => (
            <ProblemSetRow
              key={ps.id}
              ps={ps}
              variant={variant}
              detailHref={detailHref(group.course_id, ps.id)}
              onPublish={() => onPublish(ps.id)}
              onClose={() => onClose(ps.id)}
              onDelete={() => onDelete(ps.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ── ProblemSetRow (강화 — 좌 도넛 + 우 정보) ─────────────────────────────────

interface ProblemSetRowProps {
  ps: ProblemSetWithStats;
  variant: "admin" | "student";
  detailHref: string;
  onPublish: () => void;
  onClose: () => void;
  onDelete: () => void;
}

function ProblemSetRow({
  ps, variant, detailHref, onPublish, onClose, onDelete,
}: ProblemSetRowProps) {
  const due = fmtDue(ps.due_date);
  const stats = ps.stats || {};

  // 학생: best_score → 도넛, 미시도면 빈 도넛 + "새 문제"
  // 교사: avg_score → 도넛, 제출 없으면 빈 도넛
  const score =
    variant === "student"
      ? (stats as SetStatsStudent).best_score ?? 0
      : (stats as SetStatsTeacher).avg_score ?? 0;
  const isAttempted =
    variant === "student"
      ? ((stats as SetStatsStudent).total_count ?? 0) > 0
      : ((stats as SetStatsTeacher).submissions_count ?? 0) > 0;
  const needsReviewN = (stats as SetStatsTeacher).needs_review_count ?? 0;

  return (
    <Link href={detailHref} className="block px-4 py-3 hover:bg-bg-secondary transition">
      <div className="flex items-center gap-3">
        {/* 좌측 도넛 */}
        <CircularProgress
          value={isAttempted ? score : 0}
          size={56}
          strokeWidth={5}
          label={isAttempted ? `${Math.round(score * 100)}` : "—"}
          tone={isAttempted ? "auto" : "gray"}
        />

        {/* 정보 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-body font-medium text-text-primary truncate">
              {ps.title}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE_TONE[ps.status]}`}>
              {STATUS_LABEL[ps.status]}
            </span>
            {!isAttempted && variant === "student" && ps.status === "published" && (
              <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded flex items-center gap-0.5">
                <Sparkles size={10} /> 새 문제
              </span>
            )}
            {needsReviewN > 0 && variant === "admin" && (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded flex items-center gap-0.5 font-semibold">
                <AlertTriangle size={10} /> 검토 {needsReviewN}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-0.5">
              <FileQuestion size={11} /> {ps.problem_count}문제
            </span>
            <span className={`flex items-center gap-0.5 ${
              due.tone === "urgent" ? "text-red-700 font-semibold" :
              due.tone === "soon" ? "text-amber-700" :
              due.tone === "past" ? "text-text-tertiary line-through" : ""
            }`}>
              <Clock size={11} /> {due.text}
            </span>
            {variant === "student" && isAttempted && (
              <>
                <span>시도 {(stats as SetStatsStudent).attempts_used ?? 0}/{ps.max_attempts}</span>
                {(stats as SetStatsStudent).last_submitted_at && (
                  <span>마지막 {fmtRelative((stats as SetStatsStudent).last_submitted_at)}</span>
                )}
              </>
            )}
            {variant === "admin" && (
              <>
                <span>응시 {(stats as SetStatsTeacher).submissions_count ?? 0}명</span>
                {isAttempted && <AccuracyBadge value={score} />}
              </>
            )}
          </div>
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {variant === "admin" && (
            <>
              {ps.status === "draft" && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); onPublish(); }}
                  className="text-caption px-2 py-1 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50"
                >
                  게시
                </button>
              )}
              {ps.status === "published" && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); onClose(); }}
                  className="text-caption px-2 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
                >
                  마감
                </button>
              )}
              <Link
                href={detailHref}
                className="text-text-tertiary hover:text-text-primary p-1"
                aria-label="편집"
                onClick={(e) => e.stopPropagation()}
              >
                <PenLine size={14} />
              </Link>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); onDelete(); }}
                className="text-text-tertiary hover:text-red-600 p-1"
                aria-label="삭제"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          {variant === "student" && (
            <span className="text-caption px-3 py-1 bg-accent-default text-white rounded flex items-center gap-1">
              <CheckCircle2 size={12} /> 풀이
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
