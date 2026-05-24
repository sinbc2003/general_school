"use client";

/**
 * 학생용 강좌 상세 — Google Classroom 식 디자인 (admin과 동일 layout, 권한만 차이).
 *
 * 학생은 글 작성·편집 권한 X. 협업 문서·설문은 본인 권한 따라 진입.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MessageSquare, BarChart3 } from "lucide-react";
import { api } from "@/lib/api/client";
import { CourseBanner } from "@/components/classroom/CourseBanner";
import { CourseTabs, type CourseTab } from "@/components/classroom/CourseTabs";
import { CourseInfoWidget } from "@/components/classroom/CourseInfoWidget";
import { PostStreamCard } from "@/components/classroom/PostStreamCard";
import { ReadOnlyBanner } from "@/components/classroom/ReadOnlyBanner";
import { PeopleTab } from "@/components/classroom/PeopleTab";
import { CourseChatbots } from "@/components/classroom/CourseChatbots";
import { CoursewareTab } from "@/components/courseware/CoursewareTab";
import { getCourseTone } from "@/components/classroom/_color";
import { StudentCourseworkList } from "./_components/StudentCourseworkList";

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

      {/* ── 문제 (학생 풀이) ── */}
      {activeTab === "courseware" && (
        <CoursewareTab cid={cid} canEdit={false} variant="student" />
      )}

      {/* ── 챗봇 (학생은 사용만, 편집 X) ── */}
      {activeTab === "chatbots" && (
        <CourseChatbots cid={cid} canEdit={false} />
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


// PostCard → components/classroom/PostStreamCard.tsx로 이동 (Google Classroom 식)
// StudentCourseworkList → ./_components/StudentCourseworkList.tsx로 이동
