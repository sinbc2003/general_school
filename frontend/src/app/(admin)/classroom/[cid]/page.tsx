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
import { BarChart3 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { CourseBanner } from "@/components/classroom/CourseBanner";
import { CourseTabs, type CourseTab } from "@/components/classroom/CourseTabs";
import { type CreateActionKind } from "@/components/classroom/CreateMenu";
import { type PostType } from "@/components/classroom/PostComposer";
import { AssignmentModal, type AssignmentModalInitial, type CreateKind } from "@/components/classroom/AssignmentModal";
import { getCourseTone } from "@/components/classroom/_color";
import { useToast } from "@/components/ui/Toast";
import { CourseworkTab } from "./_components/Coursework";
import { BulkAddModal } from "./_components/BulkAddModal";
import { ReadOnlyBanner } from "@/components/classroom/ReadOnlyBanner";
import { PeopleTab } from "@/components/classroom/PeopleTab";
import { CourseChatbots } from "@/components/classroom/CourseChatbots";
import { StreamTab } from "./_components/StreamTab";
import type { Post, CourseDetail } from "./_components/types";

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
  // 학생은 항상 read-only. 교사/admin도 과거 학기는 read-only.
  const canEdit = course.viewer_role !== "student" && !course.is_past_semester;
  const isReadOnly = !!course.is_past_semester;

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

      {isReadOnly && <ReadOnlyBanner semester={course.semester} />}

      <CourseTabs active={activeTab} onChange={setActiveTab} tone={tone} />

      {/* ── 게시판 (Stream) — Google Classroom 식 grid (좌측 위젯 + 우측 메인) ── */}
      {activeTab === "stream" && (
        <StreamTab
          cid={cid}
          posts={posts}
          canEdit={canEdit}
          subject={course.subject}
          className={course.class_name}
          teacherName={course.teacher_name}
          studentCount={course.students.length}
          userName={user?.name}
          userId={user?.id}
          composerKey={composerKey}
          postFormInitType={postFormInitType}
          onComposerSubmit={async (body) => {
            await api.post(`/api/classroom/courses/${cid}/posts`, body);
            setPostFormInitType("notice");
            await load();
            toast.show("게시됨", "success");
          }}
          onDeletePost={deletePost}
          onEditPost={handleEdit}
          onDuplicatePost={handleDuplicate}
        />
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
        <PeopleTab
          students={course.students}
          teacherName={course.teacher_name}
          canEdit={canEdit}
          onAdd={() => setShowBulk(true)}
          onRemove={removeStudent}
        />
      )}

      {/* ── 챗봇 ── */}
      {activeTab === "chatbots" && (
        <CourseChatbots cid={cid} canEdit={canEdit} />
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
