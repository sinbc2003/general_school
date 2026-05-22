"use client";

/**
 * 학생용 강좌 상세 — Google Classroom 식 디자인 (admin과 동일 layout, 권한만 차이).
 *
 * 학생은 글 작성·편집 권한 X. 협업 문서·설문은 본인 권한 따라 진입.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MessageSquare, ClipboardList, BarChart3 } from "lucide-react";
import { api } from "@/lib/api/client";
import { CourseBanner } from "@/components/classroom/CourseBanner";
import { CourseTabs, type CourseTab } from "@/components/classroom/CourseTabs";
import { CourseInfoWidget } from "@/components/classroom/CourseInfoWidget";
import { PostStreamCard } from "@/components/classroom/PostStreamCard";
import { ReadOnlyBanner } from "@/components/classroom/ReadOnlyBanner";
import { PeopleTab } from "@/components/classroom/PeopleTab";
import { getCourseTone } from "@/components/classroom/_color";

interface Attachment {
  type: "link" | "file" | "doc" | "survey";
  title: string;
  url?: string;
  file_url?: string;
  file_name?: string;
}

interface Post {
  id: number;
  post_type: string;
  title: string;
  content: string;
  is_pinned: boolean;
  author_name?: string;
  due_date: string | null;
  max_score: number | null;
  topic: string | null;
  attachments?: Attachment[];
  created_at: string | null;
}

interface CourseStudentRow {
  id: number;
  student_id: number;
  name: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
}

interface CourseDetail {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  description: string | null;
  is_active: boolean;
  teacher_name?: string;
  student_count: number;
  students: CourseStudentRow[];
  viewer_role: "admin" | "teacher" | "student";
  is_past_semester?: boolean;
  semester?: { name: string; year: number; term: number } | null;
}

export default function StudentCourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<CourseTab>("stream");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api.get<CourseDetail>(`/api/classroom/courses/${cid}`),
        api.get<{ items: Post[] }>(`/api/classroom/courses/${cid}/posts`),
      ]);
      setCourse(c);
      setPosts(p.items);
    } catch (e: any) {
      alert(e?.detail || "강좌 조회 실패");
      router.push("/s/classroom");
    } finally {
      setLoading(false);
    }
  }, [cid, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!course) return null;

  const tone = getCourseTone(cid);
  const materials = posts.filter((p) => p.post_type !== "notice");

  return (
    <div className="max-w-5xl mx-auto">
      <CourseBanner
        cid={cid}
        name={course.name}
        subject={course.subject}
        className={course.class_name}
        teacherName={course.teacher_name}
        description={course.description}
        isActive={course.is_active}
        studentCount={course.student_count ?? course.students?.length ?? 0}
        viewerRole="student"
        tone={tone}
        baseHref="/s/classroom"
      />

      {course.is_past_semester && (
        <ReadOnlyBanner semester={course.semester} variant="student" />
      )}

      <CourseTabs active={activeTab} onChange={setActiveTab} tone={tone} />

      {/* ── 게시판 ── */}
      {activeTab === "stream" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <aside className="lg:col-span-1 order-2 lg:order-1">
            <CourseInfoWidget
              cid={cid}
              subject={course.subject}
              className={course.class_name}
              teacherName={course.teacher_name}
              studentCount={course.student_count ?? course.students?.length ?? 0}
              baseHref="/s/classroom"
              showTeacher={true}
            />
          </aside>
          <main className="lg:col-span-2 space-y-3 order-1 lg:order-2">
            {posts.length === 0 ? (
              <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-12 text-center text-caption text-text-tertiary">
                <MessageSquare size={28} className="mx-auto mb-2 opacity-30" />
                아직 작성된 글이 없습니다
              </div>
            ) : (
              <div className="space-y-2">
                {posts.map((p) => (
                  <PostStreamCard
                    key={p.id}
                    post={{ ...p, course_id: cid }}
                    baseHref="/s/classroom"
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      )}

      {/* ── 수업 과제 (주제별 그룹) ── */}
      {activeTab === "coursework" && (
        <StudentCourseworkList cid={cid} posts={materials} />
      )}

      {/* ── 사용자 ── */}
      {activeTab === "people" && (
        <PeopleTab
          students={(course.students ?? []) as any}
          teacherName={course.teacher_name}
          canEdit={false}
          variant="student"
        />
      )}

      {/* ── 성적 ── */}
      {activeTab === "grades" && (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 text-center">
          <BarChart3 size={32} className="mx-auto text-text-tertiary opacity-30 mb-3" />
          <div className="text-body text-text-secondary mb-1">성적은 준비 중입니다</div>
          <div className="text-caption text-text-tertiary">
            추후 본인의 과제·평가 점수를 강좌별로 확인할 수 있습니다.
          </div>
        </div>
      )}
    </div>
  );
}


// ─── 학생용 수업 과제 list — Google Classroom 식 주제별 그룹 ───
function StudentCourseworkList({ cid, posts }: { cid: number; posts: Post[] }) {
  // 주제 옵션 (필터용)
  const allTopics = Array.from(new Set(posts.map((p) => p.topic).filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b, "ko"));
  const [topicFilter, setTopicFilter] = useState<string>("__all__");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = topicFilter === "__all__"
    ? posts
    : topicFilter === "__none__"
      ? posts.filter((p) => !p.topic)
      : posts.filter((p) => p.topic === topicFilter);

  const groups: Record<string, Post[]> = {};
  for (const p of filtered) {
    const key = p.topic || "주제 없음";
    groups[key] = groups[key] || [];
    groups[key].push(p);
  }
  const topicOrder = Object.keys(groups).sort((a, b) => {
    if (a === "주제 없음") return 1;
    if (b === "주제 없음") return -1;
    return a.localeCompare(b, "ko");
  });

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const allCollapsed = collapsed.size > 0 && collapsed.size >= topicOrder.length;
  const toggleAll = () => {
    if (allCollapsed) setCollapsed(new Set());
    else setCollapsed(new Set(topicOrder));
  };

  if (posts.length === 0) {
    return (
      <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 text-center text-caption text-text-tertiary">
        <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
        <div className="text-body mb-1">아직 과제·자료가 없습니다</div>
        선생님이 자료를 올리면 여기에 표시됩니다
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 주제 필터 + 모두 접기 — Google Classroom 식 */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex-1 max-w-sm">
          <label className="block text-[10.5px] text-text-tertiary mb-1 px-3">주제 필터</label>
          <div className="relative">
            <select
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              className="w-full pl-3 pr-8 py-2.5 text-body bg-bg-primary border border-border-default rounded-md appearance-none cursor-pointer hover:border-text-tertiary"
            >
              <option value="__all__">모든 주제</option>
              {allTopics.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="__none__">주제 없음</option>
            </select>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-tertiary"
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="text-caption text-accent hover:underline inline-flex items-center gap-1 whitespace-nowrap"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="18 15 12 9 6 15"></polyline>
            <polyline points="6 21 12 15 18 21"></polyline>
          </svg>
          {allCollapsed ? "모두 펼치기" : "모두 접기"}
        </button>
      </div>

      {topicOrder.map((topicKey) => (
        <div key={topicKey}>
          {/* 큰 주제 헤더 */}
          <button
            type="button"
            onClick={() => toggleCollapse(topicKey)}
            className="w-full flex items-center justify-between py-2 px-1 border-b border-border-default text-left group"
          >
            <div className="text-[20px] font-medium text-text-primary group-hover:opacity-90">
              {topicKey}
            </div>
            <svg
              width="20" height="20" viewBox="0 0 24 24"
              className={`text-text-tertiary transition-transform ${collapsed.has(topicKey) ? "" : "rotate-180"}`}
              fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
          {!collapsed.has(topicKey) && (
            <div className="mt-2 space-y-2">
              {groups[topicKey].map((p) => {
                const isAssignment = p.post_type === "assignment_ref";
                const dateStr = p.created_at
                  ? new Date(p.created_at).toLocaleDateString("ko-KR", {
                      year: "numeric", month: "numeric", day: "numeric",
                    })
                  : "";
                return (
                  <Link
                    key={p.id}
                    href={`/s/classroom/${cid}/posts/${p.id}`}
                    className="bg-bg-primary border border-border-default rounded-lg flex items-center gap-3 px-5 py-3.5 hover:shadow-sm transition"
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isAssignment
                          ? "linear-gradient(135deg, #fde4b8 0%, #fbbf24 100%)"
                          : "linear-gradient(135deg, #bbf7d0 0%, #4ade80 100%)",
                        color: isAssignment ? "#a16207" : "#15803d",
                      }}
                    >
                      <ClipboardList size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14.5px] text-text-primary truncate">{p.title}</div>
                      {p.due_date && (
                        <div className="text-[11.5px] text-status-error mt-0.5">
                          기한 {new Date(p.due_date).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
                          {p.max_score != null && ` · ${p.max_score}점`}
                        </div>
                      )}
                    </div>
                    <div className="text-[12.5px] text-text-tertiary whitespace-nowrap">
                      게시일: {dateStr}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


// PostCard → components/classroom/PostStreamCard.tsx로 이동 (Google Classroom 식)
