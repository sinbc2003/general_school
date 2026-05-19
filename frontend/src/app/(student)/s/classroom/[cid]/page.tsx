"use client";

/**
 * 학생용 강좌 상세 — Google Classroom 식 디자인 (admin과 동일 layout, 권한만 차이).
 *
 * 학생은 글 작성·편집 권한 X. 협업 문서·설문은 본인 권한 따라 진입.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Pin, Users, MessageSquare, ClipboardList, BarChart3 } from "lucide-react";
import { api } from "@/lib/api/client";
import { CourseBanner } from "@/components/classroom/CourseBanner";
import { CourseTabs, type CourseTab } from "@/components/classroom/CourseTabs";
import { CourseInfoWidget } from "@/components/classroom/CourseInfoWidget";
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
                {posts.map((p) => <PostCard key={p.id} post={p} />)}
              </div>
            )}
          </main>
        </div>
      )}

      {/* ── 수업 과제 (주제별 그룹) ── */}
      {activeTab === "coursework" && (
        <StudentCourseworkList posts={materials} />
      )}

      {/* ── 사용자 ── */}
      {activeTab === "people" && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-5">
          {course.teacher_name && (
            <div className="text-caption text-text-tertiary mb-3 px-2 py-1.5 bg-bg-secondary rounded">
              담당 교사: <span className="text-text-primary font-medium">{course.teacher_name}</span>
            </div>
          )}
          <h2 className="text-body font-semibold flex items-center gap-1 mb-3">
            <Users size={15} /> 함께하는 학생 ({course.students?.length ?? 0})
          </h2>
          {!course.students || course.students.length === 0 ? (
            <div className="text-caption text-text-tertiary py-6 text-center">
              등록된 학생 정보 없음
            </div>
          ) : (
            <div className="divide-y divide-border-default">
              {course.students.map((s) => (
                <div key={s.id} className="px-2 py-2 text-caption">
                  <span className="font-medium text-text-primary">{s.name}</span>
                  <span className="text-text-tertiary ml-2">
                    {s.grade && s.class_number && s.student_number
                      ? `${s.grade}${String(s.class_number).padStart(2, "0")}${String(s.student_number).padStart(2, "0")}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
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
function StudentCourseworkList({ posts }: { posts: Post[] }) {
  const groups: Record<string, Post[]> = {};
  for (const p of posts) {
    const key = p.topic || "주제 없음";
    groups[key] = groups[key] || [];
    groups[key].push(p);
  }
  const topicOrder = Object.keys(groups).sort((a, b) => {
    if (a === "주제 없음") return 1;
    if (b === "주제 없음") return -1;
    return a.localeCompare(b, "ko");
  });

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
    <div className="space-y-4">
      {topicOrder.map((topicKey) => (
        <div key={topicKey} className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border-default text-body font-semibold text-accent">
            {topicKey}
          </div>
          <div className="divide-y divide-border-default">
            {groups[topicKey].map((p) => {
              const isAssignment = p.post_type === "assignment_ref";
              return (
                <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-bg-secondary">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: isAssignment ? "#fef3c7" : "#dcfce7",
                      color: isAssignment ? "#a16207" : "#15803d",
                    }}
                  >
                    <ClipboardList size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-body font-medium text-text-primary truncate">{p.title}</div>
                    {p.due_date && (
                      <div className="text-[11.5px] text-status-error mt-0.5">
                        기한 {new Date(p.due_date).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
                        {p.max_score != null && ` · ${p.max_score}점`}
                      </div>
                    )}
                    {!p.due_date && p.max_score != null && (
                      <div className="text-[11.5px] text-text-tertiary mt-0.5">{p.max_score}점</div>
                    )}
                  </div>
                  <div className="text-caption text-text-tertiary whitespace-nowrap">
                    게시일: {p.created_at && new Date(p.created_at).toLocaleString("ko-KR", { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


function PostCard({ post }: { post: Post }) {
  const typeLabels: Record<string, { label: string; color: string }> = {
    notice: { label: "공지", color: "bg-cream-200 text-blue-700" },
    material: { label: "자료", color: "bg-green-100 text-green-700" },
    assignment_ref: { label: "과제", color: "bg-purple-100 text-purple-700" },
  };
  const meta = typeLabels[post.post_type] || typeLabels.notice;
  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-4 hover:shadow-sm transition">
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-1.5 py-0.5 text-[10px] rounded ${meta.color}`}>{meta.label}</span>
        {post.is_pinned && <Pin size={11} className="text-accent" />}
        <span className="text-body font-medium flex-1 truncate">{post.title}</span>
        <span className="text-caption text-text-tertiary">
          {post.created_at && post.created_at.slice(0, 10)}
        </span>
      </div>
      <div className="text-caption text-text-secondary whitespace-pre-wrap">{post.content}</div>
      {post.author_name && (
        <div className="text-caption text-text-tertiary mt-2">— {post.author_name}</div>
      )}
    </div>
  );
}
