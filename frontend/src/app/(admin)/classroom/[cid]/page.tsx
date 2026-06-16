"use client";

/**
 * 강좌 상세 (관리자·교사용).
 *
 * - 상단: 강좌 정보 + 편집
 * - 좌측: 학생 명단 + 일괄 등록 (전교생 명단에서 선택 — StudentPickerModal)
 * - 우측: 클래스룸 글 (공지·자료) 작성·목록
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import GradebookTab from "@/components/classroom/GradebookTab";
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
import { StudentPickerModal } from "@/components/StudentPickerModal";
import { ReadOnlyBanner } from "@/components/classroom/ReadOnlyBanner";
import { PeopleTab } from "@/components/classroom/PeopleTab";
import { CourseChatbots } from "@/components/classroom/CourseChatbots";
import { StreamTab } from "./_components/StreamTab";
import { ReusePostModal, type ReusablePost } from "@/components/classroom/ReusePostModal";
import { ProblemSetCreateModal } from "@/components/courseware/ProblemSetCreateModal";
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
  // 만들기 메뉴 — 게시물 재사용 / 퀴즈 과제 (코스웨어 문제 세트)
  const [showReuse, setShowReuse] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  // 만들기 메뉴에서 문서/덱/설문/챗봇 선택 시 — 자료 글에 자동 첨부 (게시하면 수업 과제에 표시)
  const [modalAutoAttach, setModalAutoAttach] = useState<
    "doc" | "deck" | "survey" | "chatbot" | undefined
  >();

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

  // 학생 일괄 등록 — 명단 선택(user_ids) 또는 학번 붙여넣기(student_numbers) 모두 같은 bulk endpoint.
  // 성공 시 toast + reload, 실패 시 toast 후 rethrow(모달 열린 채 유지).
  const enrollStudents = async (body: { user_ids?: number[]; student_numbers?: number[] }) => {
    try {
      const res = await api.post<{ added: number; skipped: number; reactivated: number }>(
        `/api/classroom/courses/${cid}/students/bulk`, body,
      );
      const parts: string[] = [];
      if (res.added) parts.push(`추가 ${res.added}`);
      if (res.reactivated) parts.push(`재활성화 ${res.reactivated}`);
      if (res.skipped) parts.push(`중복 ${res.skipped}`);
      await load();
      toast.show(`수강생 등록: ${parts.join(" · ") || "변경 없음"}`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "등록 실패", "error");
      throw e;
    }
  };

  const handleCreate = (kind: CreateActionKind) => {
    if (kind === "assignment" || kind === "material") {
      setModalKind(kind);
      setModalInitial(undefined);
      setModalMode(undefined);
      setModalAutoAttach(undefined);
    } else if (kind === "quiz") {
      setShowQuiz(true);
    } else if (kind === "reuse") {
      setShowReuse(true);
    } else if (kind === "doc" || kind === "deck" || kind === "survey" || kind === "chatbot") {
      // Google Classroom 식 — 자료 글 작성 화면 + 해당 자료 자동 첨부.
      // 게시하면 수업 과제 탭에 글로 나타난다 (도구 페이지 단독 생성은 기존 링크 사용).
      setModalKind("material");
      setModalInitial(undefined);
      setModalMode(undefined);
      setModalAutoAttach(kind);
    }
  };

  // 게시물 재사용 — 다른 강좌 글을 duplicate 모드로 prefill (기한은 비움, 제목 유지)
  const handleReusePick = (post: ReusablePost) => {
    setShowReuse(false);
    const k: CreateKind = post.post_type === "assignment_ref" ? "assignment" : "material";
    setModalKind(k);
    setModalInitial({
      title: post.title,
      content: post.content,
      max_score: post.max_score,
      due_date: null,
      topic: post.topic,
      attachments: post.attachments,
    });
    setModalMode("duplicate");
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
    setModalAutoAttach(undefined);
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

      {/* ── 성적 ── */}
      {activeTab === "grades" && <GradebookTab cid={cid} />}

      <StudentPickerModal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        title="수강생 추가"
        confirmLabel="등록"
        excludedUserIds={course.students.map((s) => s.student_id)}
        onConfirm={(userIds) => enrollStudents({ user_ids: userIds })}
        onConfirmNumbers={(studentNumbers) => enrollStudents({ student_numbers: studentNumbers })}
      />

      {modalKind && (
        <AssignmentModal
          cid={cid}
          kind={modalKind}
          studentCount={course.students.length}
          existingTopics={Array.from(new Set(posts.map((p) => p.topic).filter(Boolean) as string[]))}
          courseName={course.name}
          initial={modalInitial}
          mode={modalMode}
          autoAttach={modalAutoAttach}
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

      {/* 게시물 재사용 (Google Classroom 식) */}
      {showReuse && (
        <ReusePostModal
          currentCid={cid}
          onClose={() => setShowReuse(false)}
          onPick={handleReusePick}
        />
      )}

      {/* 퀴즈 과제 — 코스웨어 문제 세트 생성 */}
      {showQuiz && (
        <ProblemSetCreateModal
          cid={cid}
          onClose={() => setShowQuiz(false)}
          onCreated={(psid) => {
            setShowQuiz(false);
            router.push(`/classroom/${cid}/courseware/${psid}`);
          }}
        />
      )}
    </div>
  );
}
