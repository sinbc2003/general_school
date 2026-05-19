"use client";

/**
 * 강좌 상세 (관리자·교사용).
 *
 * - 상단: 강좌 정보 + 편집
 * - 좌측: 학생 명단 + 일괄 등록 (학번)
 * - 우측: 클래스룸 글 (공지·자료) 작성·목록
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Users, MessageSquare, Plus, Trash2, Pin, Save, X, UserPlus, BarChart3,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { CourseBanner } from "@/components/classroom/CourseBanner";
import { CourseTabs, type CourseTab } from "@/components/classroom/CourseTabs";
import { getCourseTone } from "@/components/classroom/_color";

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

  const tone = getCourseTone(cid);
  const canEdit = course.viewer_role !== "student";

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
        studentCount={course.students.length}
        viewerRole={course.viewer_role}
        tone={tone}
      />

      <CourseTabs active={activeTab} onChange={setActiveTab} tone={tone} />

      {/* ── 게시판 (Stream) ── */}
      {activeTab === "stream" && (
        <div className="space-y-3">
          {canEdit && (
            <div className="bg-bg-primary border border-border-default rounded-lg p-4">
              {showPostForm ? (
                <PostForm
                  cid={cid}
                  onClose={() => setShowPostForm(false)}
                  onSaved={() => { setShowPostForm(false); load(); }}
                />
              ) : (
                <button
                  onClick={() => setShowPostForm(true)}
                  className="w-full text-left text-caption text-text-tertiary px-3 py-2 border border-border-default rounded bg-bg-secondary hover:bg-bg-primary"
                >
                  <Plus size={12} className="inline mr-1" />
                  수업에 새 글 또는 자료를 공유하세요...
                </button>
              )}
            </div>
          )}

          {posts.length === 0 ? (
            <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-12 text-center text-caption text-text-tertiary">
              <MessageSquare size={28} className="mx-auto mb-2 opacity-30" />
              아직 작성된 글이 없습니다
            </div>
          ) : (
            <div className="space-y-2">
              {posts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  onDelete={() => deletePost(p.id)}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 수업 과제 (H3에서 정밀 설계) ── */}
      {activeTab === "coursework" && (
        <CourseworkPlaceholder
          posts={posts}
          canEdit={canEdit}
          onCreate={() => setShowPostForm(true)}
        />
      )}

      {/* ── 사용자 ── */}
      {activeTab === "people" && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-body font-semibold flex items-center gap-1">
              <Users size={15} /> 수강 학생 ({course.students.length})
            </h2>
            {canEdit && (
              <button
                onClick={() => setShowBulk(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
              >
                <UserPlus size={12} /> 학생 등록
              </button>
            )}
          </div>
          {course.teacher_name && (
            <div className="text-caption text-text-tertiary mb-3 px-2 py-1.5 bg-bg-secondary rounded">
              담당 교사: <span className="text-text-primary font-medium">{course.teacher_name}</span>
            </div>
          )}
          {course.students.length === 0 ? (
            <div className="text-caption text-text-tertiary py-8 text-center">
              등록된 학생 없음
            </div>
          ) : (
            <div className="divide-y divide-border-default">
              {course.students.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-2 py-2 hover:bg-bg-secondary rounded group text-caption"
                >
                  <div>
                    <span className="font-medium text-text-primary">{s.name}</span>
                    <span className="text-text-tertiary ml-2">
                      {s.grade && s.class_number && s.student_number
                        ? `${s.grade}${String(s.class_number).padStart(2, "0")}${String(s.student_number).padStart(2, "0")}`
                        : ""}
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => removeStudent(s.student_id, s.name)}
                      className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-error"
                      title="제외"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 성적 (placeholder) ── */}
      {activeTab === "grades" && (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 text-center">
          <BarChart3 size={32} className="mx-auto text-text-tertiary opacity-30 mb-3" />
          <div className="text-body text-text-secondary mb-1">성적 모듈은 준비 중입니다</div>
          <div className="text-caption text-text-tertiary">
            추후 과제·평가 점수를 강좌별로 집계해 표시합니다.
          </div>
        </div>
      )}

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


// ─── 수업 과제 탭 placeholder — H3 commit에서 + 만들기 dropdown 추가 ───
function CourseworkPlaceholder({
  posts, canEdit, onCreate,
}: { posts: Post[]; canEdit: boolean; onCreate: () => void }) {
  const materials = posts.filter((p) => p.post_type !== "notice");
  return (
    <div className="space-y-3">
      {canEdit && (
        <div>
          <button
            onClick={onCreate}
            className="flex items-center gap-1 px-4 py-2 text-caption bg-accent text-white rounded-full hover:bg-accent-hover shadow-sm"
          >
            <Plus size={14} /> 만들기
          </button>
        </div>
      )}
      {materials.length === 0 ? (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 text-center text-caption text-text-tertiary">
          <div className="text-body mb-1">과제물을 할당하는 공간</div>
          학생들을 위한 과제와 자료를 추가하면 여기에 표시됩니다
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg divide-y divide-border-default">
          {materials.map((p) => (
            <div key={p.id} className="px-4 py-3 hover:bg-bg-secondary">
              <div className="text-body font-medium">{p.title}</div>
              <div className="text-caption text-text-tertiary mt-0.5">
                {p.post_type === "material" ? "자료" : "과제"}
                {p.created_at && ` · ${p.created_at.slice(0, 10)}`}
              </div>
            </div>
          ))}
        </div>
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
