"use client";

/**
 * 강좌 상세 (관리자·교사용).
 *
 * - 상단: 강좌 정보 + 편집
 * - 좌측: 학생 명단 + 일괄 등록 (학번)
 * - 우측: 클래스룸 글 (공지·자료) 작성·목록
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Users, MessageSquare, Plus, Trash2, Pin, Edit3, Save, X, UserPlus, FileText,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface Student {
  id: number;
  student_id: number;
  name: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  joined_at: string | null;
}

interface Post {
  id: number;
  course_id: number;
  author_id: number | null;
  author_name?: string;
  post_type: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string | null;
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
  students: Student[];
  viewer_role: "admin" | "teacher" | "student";
}

export default function CourseDetailAdminPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPostForm, setShowPostForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

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
      router.push("/classroom");
    } finally {
      setLoading(false);
    }
  }, [cid, router]);

  useEffect(() => { load(); }, [load]);

  const removeStudent = async (sid: number, name: string) => {
    if (!confirm(`${name} 학생을 강좌에서 제외합니까?`)) return;
    try {
      await api.delete(`/api/classroom/courses/${cid}/students/${sid}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "실패");
    }
  };

  const deletePost = async (pid: number) => {
    if (!confirm("이 글을 삭제합니까?")) return;
    try {
      await api.delete(`/api/classroom/posts/${pid}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "실패");
    }
  };

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!course) return null;

  return (
    <div>
      <div className="mb-4">
        <Link href="/classroom" className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1">
          <ArrowLeft size={12} /> 목록으로
        </Link>
        <div className="flex items-start justify-between mt-1 gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-title text-text-primary">{course.name}</h1>
            <div className="text-caption text-text-tertiary mt-1">
              {course.subject} {course.class_name && `· ${course.class_name}`}
              {course.teacher_name && ` · 담당: ${course.teacher_name}`}
            </div>
            {course.description && (
              <p className="text-body text-text-secondary mt-2">{course.description}</p>
            )}
          </div>
          <Link
            href={`/classroom/${cid}/docs`}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-cream-100 border border-cream-300 text-text-primary rounded hover:bg-cream-200 whitespace-nowrap"
            title="강좌 협업 문서 (Google Docs 식 실시간 편집)"
          >
            <FileText size={13} /> 협업 문서
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 학생 명단 */}
        <div className="lg:col-span-1">
          <div className="bg-bg-primary border border-border-default rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-body font-semibold flex items-center gap-1">
                <Users size={14} /> 수강 학생 ({course.students.length})
              </h2>
              <button
                onClick={() => setShowBulk(true)}
                className="flex items-center gap-1 px-2 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover"
              >
                <UserPlus size={12} /> 등록
              </button>
            </div>

            {course.students.length === 0 ? (
              <div className="text-caption text-text-tertiary py-3 text-center">
                등록된 학생 없음
              </div>
            ) : (
              <div className="space-y-1 max-h-[500px] overflow-y-auto">
                {course.students.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-2 py-1.5 text-caption hover:bg-bg-secondary rounded group"
                  >
                    <div>
                      <span className="font-medium">{s.name}</span>
                      <span className="text-text-tertiary ml-1">
                        {s.grade && s.class_number && s.student_number
                          ? `${s.grade}${String(s.class_number).padStart(2, "0")}${String(s.student_number).padStart(2, "0")}`
                          : ""}
                      </span>
                    </div>
                    <button
                      onClick={() => removeStudent(s.student_id, s.name)}
                      className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-error"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 클래스룸 글 */}
        <div className="lg:col-span-2">
          <div className="bg-bg-primary border border-border-default rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-body font-semibold flex items-center gap-1">
                <MessageSquare size={14} /> 클래스룸 글
              </h2>
              {(course.viewer_role === "teacher" || course.viewer_role === "admin") && (
                <button
                  onClick={() => setShowPostForm(true)}
                  className="flex items-center gap-1 px-2 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover"
                >
                  <Plus size={12} /> 글 작성
                </button>
              )}
            </div>

            {showPostForm && (
              <PostForm
                cid={cid}
                onClose={() => setShowPostForm(false)}
                onSaved={() => { setShowPostForm(false); load(); }}
              />
            )}

            {posts.length === 0 ? (
              <div className="text-caption text-text-tertiary py-6 text-center">
                아직 작성된 글이 없습니다
              </div>
            ) : (
              <div className="space-y-2">
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} onDelete={() => deletePost(p.id)} canEdit={course.viewer_role !== "student"} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showBulk && (
        <BulkAddModal
          cid={cid}
          onClose={() => setShowBulk(false)}
          onSaved={() => { setShowBulk(false); load(); }}
        />
      )}
    </div>
  );
}


// ─── 글 카드 ───
function PostCard({ post, onDelete, canEdit }: { post: Post; onDelete: () => void; canEdit: boolean }) {
  const typeLabels: Record<string, { label: string; color: string }> = {
    notice: { label: "공지", color: "bg-cream-200 text-blue-700" },
    material: { label: "자료", color: "bg-green-100 text-green-700" },
    assignment_ref: { label: "과제", color: "bg-purple-100 text-purple-700" },
  };
  const meta = typeLabels[post.post_type] || typeLabels.notice;
  return (
    <div className="border border-border-default rounded p-3 hover:bg-bg-secondary">
      <div className="flex items-center gap-2 mb-1">
        <span className={`px-1.5 py-0.5 text-[10px] rounded ${meta.color}`}>{meta.label}</span>
        {post.is_pinned && <Pin size={11} className="text-accent" />}
        <span className="text-body font-medium flex-1 truncate">{post.title}</span>
        <span className="text-caption text-text-tertiary">
          {post.created_at && post.created_at.slice(0, 10)}
        </span>
        {canEdit && (
          <button onClick={onDelete} className="text-text-tertiary hover:text-status-error">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="text-caption text-text-secondary whitespace-pre-wrap">{post.content}</div>
      {post.author_name && (
        <div className="text-caption text-text-tertiary mt-1">— {post.author_name}</div>
      )}
    </div>
  );
}


// ─── 글 작성 ───
function PostForm({ cid, onClose, onSaved }: { cid: number; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [postType, setPostType] = useState<"notice" | "material" | "assignment_ref">("notice");
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim() || !content.trim()) return alert("제목·내용 필수");
    setSaving(true);
    try {
      await api.post(`/api/classroom/courses/${cid}/posts`, {
        title: title.trim(),
        content: content.trim(),
        post_type: postType,
        is_pinned: isPinned,
      });
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 p-3 border border-accent bg-accent-light rounded space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={postType}
          onChange={(e) => setPostType(e.target.value as any)}
          className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary"
        >
          <option value="notice">공지</option>
          <option value="material">자료</option>
          <option value="assignment_ref">과제 안내</option>
        </select>
        <label className="flex items-center gap-1 text-caption cursor-pointer">
          <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
          상단 고정
        </label>
        <div className="flex-1" />
        <button onClick={onClose}><X size={14} /></button>
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        className="w-full px-2 py-1 text-body border border-border-default rounded bg-bg-primary"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder="내용"
        className="w-full px-2 py-1 text-body border border-border-default rounded bg-bg-primary resize-y"
      />
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Save size={12} /> {saving ? "저장 중..." : "게시"}
        </button>
      </div>
    </div>
  );
}


// ─── 학생 일괄 등록 ───
function BulkAddModal({ cid, onClose, onSaved }: { cid: number; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const numbers = text
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));
    if (numbers.length === 0) return alert("학번을 입력하세요");
    setSaving(true);
    try {
      const res = await api.post<{ added: number; skipped: number; reactivated: number; errors?: string[] }>(
        `/api/classroom/courses/${cid}/students/bulk`,
        { student_numbers: numbers },
      );
      alert(`등록 완료\n- 추가: ${res.added}\n- 재활성화: ${res.reactivated}\n- 중복 skip: ${res.skipped}${res.errors?.length ? "\n- 오류: " + res.errors.join(", ") : ""}`);
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold">학생 일괄 등록</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-caption text-text-secondary">
            한국 학교 표준 5자리 학번(<b>10101</b> = 1학년 1반 1번)을 쉼표·공백·줄바꿈으로 구분해 입력하세요.
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="예시:&#10;20315&#10;20316&#10;20317&#10;또는: 20315, 20316, 20317"
            className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary font-mono text-caption resize-y"
          />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border-default">
          <button onClick={onClose} className="px-4 py-1.5 text-caption border border-border-default rounded">취소</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded disabled:opacity-50"
          >
            <UserPlus size={14} /> {saving ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
