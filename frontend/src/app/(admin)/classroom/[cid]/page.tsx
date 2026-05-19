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
  Users, MessageSquare, Trash2, Pin, X, UserPlus, BarChart3,
} from "lucide-react";
import { api } from "@/lib/api/client";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { CourseBanner } from "@/components/classroom/CourseBanner";
import { CourseTabs, type CourseTab } from "@/components/classroom/CourseTabs";
import { CreateMenu, type CreateActionKind } from "@/components/classroom/CreateMenu";
import { PostComposer, type PostType } from "@/components/classroom/PostComposer";
import { CourseInfoWidget } from "@/components/classroom/CourseInfoWidget";
import { AssignmentModal, type CreateKind } from "@/components/classroom/AssignmentModal";
import { getCourseTone } from "@/components/classroom/_color";
import { useToast } from "@/components/ui/Toast";

interface Student {
  id: number;
  student_id: number;
  name: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  joined_at: string | null;
}

interface Attachment {
  type: "link" | "file" | "doc" | "survey";
  title: string;
  url?: string;
  file_url?: string;
  file_name?: string;
  doc_id?: number;
  survey_id?: number;
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
  due_date: string | null;
  max_score: number | null;
  topic: string | null;
  attachments: Attachment[];
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
  const { user } = useAuth();
  const toast = useToast();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBulk, setShowBulk] = useState(false);
  const [activeTab, setActiveTab] = useState<CourseTab>("stream");
  // PostComposer 초기 post_type — CreateMenu에서 [과제/자료] 선택 시 미리 채움
  const [postFormInitType, setPostFormInitType] = useState<PostType>("notice");
  // composerKey > 0이면 강제 remount + 펼침 상태로 시작 (CreateMenu에서 진입한 신호)
  const [composerKey, setComposerKey] = useState(0);
  // 풀스크린 과제·자료 생성 modal
  const [modalKind, setModalKind] = useState<CreateKind | null>(null);

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

  const handleCreate = (kind: CreateActionKind) => {
    if (kind === "assignment" || kind === "material") {
      // 풀스크린 modal — 점수·기한·주제·첨부 함께 설정
      setModalKind(kind);
    } else if (kind === "doc") {
      router.push(`/classroom/${cid}/docs`);
    } else if (kind === "survey") {
      router.push(`/classroom/${cid}/surveys`);
    }
  };

  const deletePost = async (pid: number) => {
    if (!confirm("이 글을 삭제합니까?")) return;
    try {
      await api.delete(`/api/classroom/posts/${pid}`);
      await load();
      toast.show("삭제됨", "success");
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

      {/* ── 게시판 (Stream) — Google Classroom 식 grid (좌측 위젯 + 우측 메인) ── */}
      {activeTab === "stream" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <aside className="lg:col-span-1 order-2 lg:order-1">
            <CourseInfoWidget
              cid={cid}
              subject={course.subject}
              className={course.class_name}
              teacherName={course.teacher_name}
              studentCount={course.students.length}
              baseHref="/classroom"
              showTeacher={true}
            />
          </aside>

          <main className="lg:col-span-2 space-y-3 order-1 lg:order-2">
            {canEdit && (
              <PostComposer
                key={`composer-${composerKey}`}
                userName={user?.name}
                userId={user?.id}
                initType={postFormInitType}
                initOpen={composerKey > 0}
                onSubmit={async (body) => {
                  await api.post(`/api/classroom/courses/${cid}/posts`, body);
                  setPostFormInitType("notice");
                  await load();
                }}
              />
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
          </main>
        </div>
      )}

      {/* ── 수업 과제 ── */}
      {activeTab === "coursework" && (
        <CourseworkTab
          cid={cid}
          posts={posts}
          canEdit={canEdit}
          tone={tone}
          onCreate={(kind) => handleCreate(kind)}
          onDelete={deletePost}
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

      {modalKind && (
        <AssignmentModal
          cid={cid}
          kind={modalKind}
          studentCount={course.students.length}
          existingTopics={Array.from(new Set(posts.map((p) => p.topic).filter(Boolean) as string[]))}
          onClose={() => setModalKind(null)}
          onSaved={() => {
            const label = modalKind === "assignment" ? "과제가 생성됨" : "자료가 게시됨";
            setModalKind(null);
            setActiveTab("coursework");
            load();
            toast.show(label, "success");
          }}
        />
      )}
    </div>
  );
}


// ─── 수업 과제 탭 — Google Classroom 식 주제별 그룹 + 항목 아이콘 + 더보기 메뉴 ───
function CourseworkTab({
  cid, posts, canEdit, tone, onCreate, onDelete,
}: {
  cid: number; posts: Post[]; canEdit: boolean;
  tone: { accent: string };
  onCreate: (kind: CreateActionKind) => void;
  onDelete: (pid: number) => void;
}) {
  // 과제·자료만 (공지는 게시판 탭에서)
  const materials = posts.filter((p) => p.post_type !== "notice");
  // 주제별 그룹화: topic null → "주제 없음"
  const groups: Record<string, Post[]> = {};
  for (const p of materials) {
    const key = p.topic || "주제 없음";
    groups[key] = groups[key] || [];
    groups[key].push(p);
  }
  const topicOrder = Object.keys(groups).sort((a, b) => {
    if (a === "주제 없음") return 1;
    if (b === "주제 없음") return -1;
    return a.localeCompare(b, "ko");
  });

  const [collapsedAll, setCollapsedAll] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const toggleAll = () => {
    if (collapsedAll || collapsed.size === topicOrder.length) {
      setCollapsed(new Set());
      setCollapsedAll(false);
    } else {
      setCollapsed(new Set(topicOrder));
      setCollapsedAll(true);
    }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex items-center gap-3">
          <CreateMenu onAction={onCreate} accentColor={tone.accent} />
          <Link
            href={`/classroom/${cid}/docs`}
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
          >
            협업 문서 →
          </Link>
          <Link
            href={`/classroom/${cid}/surveys`}
            className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
          >
            설문 →
          </Link>
          {materials.length > 0 && (
            <button
              onClick={toggleAll}
              className="ml-auto text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
            >
              {collapsed.size === topicOrder.length && topicOrder.length > 0 ? "모두 펼치기" : "모두 접기"}
            </button>
          )}
        </div>
      )}

      {materials.length === 0 ? (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 px-6 text-center">
          <div className="text-body text-text-secondary mb-2">과제물을 할당하는 공간</div>
          <div className="text-caption text-text-tertiary">
            학생들을 위한 과제와 자료를 추가하면 여기에 표시됩니다
          </div>
        </div>
      ) : (
        topicOrder.map((topicKey) => (
          <TopicGroup
            key={topicKey}
            topic={topicKey}
            posts={groups[topicKey]}
            collapsed={collapsed.has(topicKey)}
            onToggle={() => toggleCollapse(topicKey)}
            canEdit={canEdit}
            onDelete={onDelete}
            tone={tone}
          />
        ))
      )}
    </div>
  );
}

function TopicGroup({
  topic, posts, collapsed, onToggle, canEdit, onDelete, tone,
}: {
  topic: string; posts: Post[]; collapsed: boolean; onToggle: () => void;
  canEdit: boolean; onDelete: (pid: number) => void;
  tone: { accent: string };
}) {
  return (
    <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-bg-secondary text-left"
      >
        <div className="text-body font-semibold" style={{ color: tone.accent }}>
          {topic}
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          className={`text-text-tertiary transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border-default border-t border-border-default">
          {posts.map((p) => (
            <CourseworkItem
              key={p.id}
              post={p}
              canEdit={canEdit}
              onDelete={() => onDelete(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CourseworkItem({
  post, canEdit, onDelete,
}: { post: Post; canEdit: boolean; onDelete: () => void }) {
  const isAssignment = post.post_type === "assignment_ref";
  const isMaterial = post.post_type === "material";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group flex items-center gap-3 px-5 py-3 hover:bg-bg-secondary cursor-pointer">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: isAssignment ? "#fef3c7" : isMaterial ? "#dcfce7" : "#dbeafe",
          color: isAssignment ? "#a16207" : isMaterial ? "#15803d" : "#1d4ed8",
        }}
      >
        {isAssignment ? <ClipboardListIcon /> : <FolderIcon />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body font-medium text-text-primary truncate">{post.title}</div>
        {post.due_date && (
          <div className="text-[11.5px] text-status-error mt-0.5">
            기한 {new Date(post.due_date).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
            {post.max_score != null && ` · ${post.max_score}점`}
          </div>
        )}
        {!post.due_date && post.max_score != null && (
          <div className="text-[11.5px] text-text-tertiary mt-0.5">{post.max_score}점</div>
        )}
      </div>
      <div className="text-caption text-text-tertiary whitespace-nowrap">
        게시일: {post.created_at && new Date(post.created_at).toLocaleString("ko-KR", { hour: "numeric", minute: "2-digit" })}
      </div>
      {canEdit && (
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="p-1.5 hover:bg-bg-primary rounded-full opacity-0 group-hover:opacity-100"
            title="더보기"
          >
            <DotsIcon />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-20 bg-bg-primary border border-border-default rounded shadow-lg w-32 py-1">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                  className="w-full text-left px-3 py-1.5 text-caption text-status-error hover:bg-bg-secondary"
                >
                  삭제
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 작은 인라인 svg 아이콘들 (lucide-react를 매번 import 안 하기 위해)
function ClipboardListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
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


// PostForm은 components/classroom/PostComposer.tsx로 대체됨.


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
