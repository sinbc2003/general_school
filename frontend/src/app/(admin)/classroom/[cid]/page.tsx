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
  Users, MessageSquare, Trash2, X, UserPlus, BarChart3,
} from "lucide-react";
import { api } from "@/lib/api/client";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { CourseBanner } from "@/components/classroom/CourseBanner";
import { CourseTabs, type CourseTab } from "@/components/classroom/CourseTabs";
import { CreateMenu, type CreateActionKind } from "@/components/classroom/CreateMenu";
import { PostComposer, type PostType } from "@/components/classroom/PostComposer";
import { CourseInfoWidget } from "@/components/classroom/CourseInfoWidget";
import { PostStreamCard } from "@/components/classroom/PostStreamCard";
import { AssignmentModal, type AssignmentModalInitial, type CreateKind } from "@/components/classroom/AssignmentModal";
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
  // 풀스크린 과제·자료 modal — 신규/편집/복제 모드 통합
  const [modalKind, setModalKind] = useState<CreateKind | null>(null);
  const [modalInitial, setModalInitial] = useState<AssignmentModalInitial | undefined>();
  const [modalMode, setModalMode] = useState<"edit" | "duplicate" | undefined>();

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
      toast.show(`${name} 학생 제외됨`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "실패", "error");
    }
  };

  const handleCreate = (kind: CreateActionKind) => {
    if (kind === "assignment" || kind === "material") {
      setModalKind(kind);
      setModalInitial(undefined);
      setModalMode(undefined);
    } else if (kind === "doc") {
      router.push(`/classroom/${cid}/docs`);
    } else if (kind === "survey") {
      router.push(`/classroom/${cid}/surveys`);
    }
  };

  const handleEdit = (post: Post) => {
    const k: CreateKind = post.post_type === "assignment_ref" ? "assignment" : "material";
    setModalKind(k);
    setModalInitial({
      postId: post.id,
      title: post.title,
      content: post.content,
      max_score: post.max_score,
      due_date: post.due_date,
      topic: post.topic,
      attachments: post.attachments,
    });
    setModalMode("edit");
  };

  const handleDuplicate = (post: Post) => {
    const k: CreateKind = post.post_type === "assignment_ref" ? "assignment" : "material";
    setModalKind(k);
    setModalInitial({
      title: post.title + " (사본)",
      content: post.content,
      max_score: post.max_score,
      due_date: null,  // 복제 시 기한은 비움 (재설정 필요)
      topic: post.topic,
      attachments: post.attachments,
    });
    setModalMode("duplicate");
  };

  const closeModal = () => {
    setModalKind(null);
    setModalInitial(undefined);
    setModalMode(undefined);
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
                  toast.show("게시됨", "success");
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
                  <PostStreamCard
                    key={p.id}
                    post={p}
                    baseHref="/classroom"
                    canEdit={canEdit}
                    onDelete={(pid) => deletePost(pid)}
                    onEdit={(pid) => {
                      const post = posts.find((x) => x.id === pid);
                      if (post) handleEdit(post);
                    }}
                    onDuplicate={(pid) => {
                      const post = posts.find((x) => x.id === pid);
                      if (post) handleDuplicate(post);
                    }}
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
          studentCount={course.students.length}
          onCreate={(kind) => handleCreate(kind)}
          onDelete={deletePost}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
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
          initial={modalInitial}
          mode={modalMode}
          onClose={closeModal}
          onSaved={() => {
            const noun = modalKind === "assignment" ? "과제" : "자료";
            const verb = modalMode === "edit" ? "저장됨" : modalMode === "duplicate" ? "복제됨" : "생성됨";
            closeModal();
            setActiveTab("coursework");
            load();
            toast.show(`${noun} ${verb}`, "success");
          }}
        />
      )}
    </div>
  );
}


// ─── 수업 과제 탭 — Google Classroom 식 ───
// (실 디자인: 상단 "주제 필터" 드롭다운 + "모두 접기" link / 주제별 큰 헤더 + chevron /
//  항목 클릭 시 인라인 펼침 "기한 없음" + "N 제출함 / M 할당됨" 큰 숫자)
function CourseworkTab({
  cid, posts, canEdit, tone, studentCount, onCreate, onDelete, onEdit, onDuplicate,
}: {
  cid: number; posts: Post[]; canEdit: boolean;
  tone: { accent: string };
  studentCount: number;
  onCreate: (kind: CreateActionKind) => void;
  onDelete: (pid: number) => void;
  onEdit: (post: Post) => void;
  onDuplicate: (post: Post) => void;
}) {
  // 과제·자료만 (공지는 게시판 탭에서)
  const materials = posts.filter((p) => p.post_type !== "notice");
  // 주제 옵션 (필터용)
  const allTopics = Array.from(new Set(materials.map((p) => p.topic).filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b, "ko"));
  // 필터 상태
  const [topicFilter, setTopicFilter] = useState<string>("__all__"); // __all__ | topic | __none__

  const filtered = topicFilter === "__all__"
    ? materials
    : topicFilter === "__none__"
      ? materials.filter((p) => !p.topic)
      : materials.filter((p) => p.topic === topicFilter);

  // 주제별 그룹화
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

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  return (
    <div className="space-y-5">
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
        <>
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
                  {allTopics.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
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
            {topicOrder.length > 0 && (
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
            )}
          </div>

          {topicOrder.map((topicKey) => (
            <TopicGroup
              key={topicKey}
              topic={topicKey}
              posts={groups[topicKey]}
              collapsed={collapsed.has(topicKey)}
              onToggle={() => toggleCollapse(topicKey)}
              canEdit={canEdit}
              onDelete={onDelete}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              tone={tone}
              studentCount={studentCount}
              cid={cid}
            />
          ))}
        </>
      )}
    </div>
  );
}

function TopicGroup({
  topic, posts, collapsed, onToggle, canEdit, onDelete, onEdit, onDuplicate,
  tone, studentCount, cid,
}: {
  topic: string; posts: Post[]; collapsed: boolean; onToggle: () => void;
  canEdit: boolean; onDelete: (pid: number) => void;
  onEdit: (post: Post) => void;
  onDuplicate: (post: Post) => void;
  tone: { accent: string };
  studentCount: number;
  cid: number;
}) {
  return (
    <div>
      {/* 큰 주제 헤더 — Google Classroom 식. 박스 없이 본문 위에 직접 (subtle border만) */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-2 px-1 border-b border-border-default text-left group"
      >
        <div className="text-[20px] font-medium text-text-primary group-hover:opacity-90">
          {topic}
        </div>
        <svg
          width="20" height="20" viewBox="0 0 24 24"
          className={`text-text-tertiary transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
      {!collapsed && (
        <div className="mt-2 space-y-2">
          {posts.map((p) => (
            <CourseworkItem
              key={p.id}
              post={p}
              canEdit={canEdit}
              onDelete={() => onDelete(p.id)}
              onEdit={() => onEdit(p)}
              onDuplicate={() => onDuplicate(p)}
              studentCount={studentCount}
              cid={cid}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CourseworkItem({
  post, canEdit, onDelete, onEdit, onDuplicate, studentCount, cid,
}: {
  post: Post; canEdit: boolean;
  onDelete: () => void; onEdit: () => void; onDuplicate: () => void;
  studentCount: number;
  cid: number;
}) {
  const isAssignment = post.post_type === "assignment_ref";
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  const dateStr = post.created_at
    ? new Date(post.created_at).toLocaleDateString("ko-KR", {
        year: "numeric", month: "numeric", day: "numeric",
      })
    : "";

  const dueStr = post.due_date
    ? `기한 ${new Date(post.due_date).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`
    : "기한 없음";

  const goDetail = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/classroom/${cid}/posts/${post.id}`);
  };

  return (
    <div
      className={`bg-bg-primary border rounded-lg overflow-hidden transition ${
        expanded ? "border-accent shadow-sm" : "border-border-default hover:shadow-sm"
      }`}
    >
      {/* 헤더 row — 클릭 시 인라인 펼침 */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-bg-secondary"
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
          {isAssignment ? <ClipboardListIcon /> : <FolderIcon />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] text-text-primary truncate">{post.title}</div>
        </div>
        <div className="text-[12.5px] text-text-tertiary whitespace-nowrap">
          게시일: {dateStr}
        </div>
        {canEdit && (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="w-7 h-7 rounded-full hover:bg-bg-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              title="더보기"
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
                <div className="absolute top-full right-0 mt-1 z-20 bg-bg-primary border border-border-default rounded shadow-lg w-32 py-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
                    className="w-full text-left px-3 py-1.5 text-caption text-text-primary hover:bg-bg-secondary"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}
                    className="w-full text-left px-3 py-1.5 text-caption text-text-primary hover:bg-bg-secondary"
                  >
                    복제
                  </button>
                  <div className="border-t border-border-default my-1" />
                  <button
                    type="button"
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

      {/* 펼친 상태 — Google Classroom 식 (기한 + 제출함/할당됨 큰 숫자 + 본문 + "과제 안내 보기" 링크) */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-border-default">
          <div className="flex items-start gap-4 pt-4">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-text-primary mb-1">
                {dueStr}
              </div>
              {post.content && (
                <div className="text-caption text-text-secondary whitespace-pre-wrap line-clamp-6 mt-3">
                  {post.content}
                </div>
              )}
              {post.author_name && (
                <div className="text-[11.5px] text-text-tertiary mt-3">— {post.author_name}</div>
              )}
            </div>
            {isAssignment && (
              <div className="flex items-stretch gap-0 text-center">
                <div className="px-5 border-l border-border-default">
                  <div className="text-[26px] font-light text-text-primary leading-tight">—</div>
                  <div className="text-[11.5px] text-text-tertiary mt-1">제출함</div>
                </div>
                <div className="px-5 border-l border-border-default">
                  <div className="text-[26px] font-light text-text-primary leading-tight">{studentCount}</div>
                  <div className="text-[11.5px] text-text-tertiary mt-1">할당됨</div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-border-default">
            <button
              type="button"
              onClick={goDetail}
              className="text-caption text-accent hover:underline"
            >
              {isAssignment ? "과제 안내 보기" : "자료 보기"}
            </button>
          </div>
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


// PostCard → components/classroom/PostStreamCard.tsx로 이동 (Google Classroom 식)
// PostForm   → components/classroom/PostComposer.tsx로 이동


// ─── 학생 일괄 등록 ───
function BulkAddModal({ cid, onClose, onSaved }: { cid: number; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const save = async () => {
    const numbers = text
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));
    if (numbers.length === 0) {
      toast.show("학번을 입력하세요", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ added: number; skipped: number; reactivated: number; errors?: string[] }>(
        `/api/classroom/courses/${cid}/students/bulk`,
        { student_numbers: numbers },
      );
      const parts: string[] = [];
      if (res.added) parts.push(`추가 ${res.added}`);
      if (res.reactivated) parts.push(`재활성화 ${res.reactivated}`);
      if (res.skipped) parts.push(`중복 ${res.skipped}`);
      toast.show(`학생 등록: ${parts.join(" · ") || "변경 없음"}`, "success");
      onSaved();
    } catch (e: any) {
      toast.show(e?.detail || "실패", "error");
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
