"use client";

/**
 * 학생용 강좌 상세 — 읽기 전용.
 *
 * 클래스룸 글 + 강좌 정보. 학생은 글 작성/편집 권한 X.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MessageSquare, Pin, Users, FileText } from "lucide-react";
import { api } from "@/lib/api/client";

interface Post {
  id: number;
  post_type: string;
  title: string;
  content: string;
  is_pinned: boolean;
  author_name?: string;
  created_at: string | null;
}

interface CourseDetail {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  description: string | null;
  teacher_name?: string;
  student_count: number;
}

export default function StudentCourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div>
      <div className="mb-4">
        <Link href="/s/classroom" className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1">
          <ArrowLeft size={12} /> 내 수업으로
        </Link>
        <h1 className="text-title text-text-primary mt-1">{course.name}</h1>
        <div className="text-caption text-text-tertiary mt-1">
          {course.subject} {course.class_name && `· ${course.class_name}`}
          {course.teacher_name && ` · 담당: ${course.teacher_name}`}
        </div>
        {course.description && (
          <p className="text-body text-text-secondary mt-2">{course.description}</p>
        )}
        <div className="text-caption text-text-tertiary mt-2 flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Users size={12} /> {course.student_count}명 수강
          </span>
          <Link
            href={`/s/classroom/${cid}/docs`}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-cream-100 border border-cream-300 rounded hover:bg-cream-200 text-text-primary"
            title="협업 문서 (Google Docs 식 실시간 편집)"
          >
            <FileText size={12} /> 협업 문서
          </Link>
        </div>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-4">
        <h2 className="text-body font-semibold mb-3 flex items-center gap-1">
          <MessageSquare size={14} /> 클래스룸 글
        </h2>

        {posts.length === 0 ? (
          <div className="text-caption text-text-tertiary py-6 text-center">
            아직 작성된 글이 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
        )}
      </div>
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
    <div className="border border-border-default rounded p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`px-1.5 py-0.5 text-[10px] rounded ${meta.color}`}>{meta.label}</span>
        {post.is_pinned && <Pin size={11} className="text-accent" />}
        <span className="text-body font-medium flex-1 truncate">{post.title}</span>
        <span className="text-caption text-text-tertiary">
          {post.created_at && post.created_at.slice(0, 10)}
        </span>
      </div>
      <div className="text-caption text-text-secondary whitespace-pre-wrap">{post.content}</div>
      {post.author_name && (
        <div className="text-caption text-text-tertiary mt-1">— {post.author_name}</div>
      )}
    </div>
  );
}
