"use client";

/**
 * 강좌 설문지 목록 (admin·teacher).
 *
 * - 강좌 멤버 누구나 열람. 교사·관리자만 새 설문 생성.
 * - 항목 클릭 → Builder 페이지 (draft 편집) 또는 결과 (활성 후).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ClipboardList, Plus, BarChart3, Pencil, Lock, Unlock, Archive,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface CourseDetail {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  teacher_id: number;
  viewer_role: "admin" | "teacher" | "student";
}

interface SurveyItem {
  id: number;
  title: string;
  description: string | null;
  status: "draft" | "active" | "closed";
  is_anonymous: boolean;
  author_name?: string;
  created_at: string | null;
  updated_at: string | null;
}

export default function CourseSurveysPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const canCreate = course
    ? course.viewer_role === "teacher" || course.viewer_role === "admin"
    : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get<CourseDetail>(`/api/classroom/courses/${cid}`),
        api.get<{ items: SurveyItem[] }>(`/api/classroom/surveys?course_id=${cid}`),
      ]);
      setCourse(c);
      setSurveys(s.items);
    } catch (e: any) {
      alert(e?.detail || "설문 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [cid]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!course) return null;

  return (
    <div>
      <div className="mb-4">
        <Link
          href={`/classroom/${cid}`}
          className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1"
        >
          <ArrowLeft size={12} /> {course.name}
        </Link>
        <h1 className="text-title text-text-primary mt-1 flex items-center gap-2">
          <ClipboardList size={20} /> 설문지
        </h1>
        <div className="text-caption text-text-tertiary mt-1">
          수업 중 이해도 체크·의견 수렴·평가 — 단축 링크로 학생에게 배포 가능 (예정).
        </div>
      </div>

      {canCreate && (
        <div className="flex justify-end mb-3">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-3 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover"
          >
            <Plus size={12} /> 새 설문
          </button>
        </div>
      )}

      {surveys.length === 0 ? (
        <div className="text-caption text-text-tertiary py-12 text-center border border-dashed border-border-default rounded">
          아직 설문이 없습니다.
          {canCreate && " 위 [새 설문] 버튼으로 만들어보세요."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {surveys.map((s) => <SurveyCard key={s.id} cid={cid} survey={s} />)}
        </div>
      )}

      {showCreate && canCreate && (
        <CreateSurveyModal
          cid={cid}
          onClose={() => setShowCreate(false)}
          onCreated={(sid) => {
            setShowCreate(false);
            router.push(`/classroom/${cid}/surveys/${sid}`);
          }}
        />
      )}
    </div>
  );
}


function SurveyCard({ cid, survey: s }: { cid: number; survey: SurveyItem }) {
  const statusMeta: Record<string, { label: string; cls: string; Icon: any }> = {
    draft: { label: "초안", cls: "bg-cream-200 text-text-secondary", Icon: Pencil },
    active: { label: "응답 중", cls: "bg-green-100 text-green-700", Icon: Unlock },
    closed: { label: "마감", cls: "bg-amber-100 text-amber-700", Icon: Archive },
  };
  const meta = statusMeta[s.status] || statusMeta.draft;
  const Icon = meta.Icon;

  return (
    <Link
      href={`/classroom/${cid}/surveys/${s.id}`}
      className="group border border-border-default rounded-lg p-4 hover:border-accent hover:shadow-sm transition bg-bg-primary"
    >
      <div className="flex items-start justify-between mb-2">
        <ClipboardList size={16} className="text-accent flex-shrink-0 mt-0.5" />
        <span className={`text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${meta.cls}`}>
          <Icon size={9} /> {meta.label}
        </span>
      </div>
      <div className="text-body font-medium text-text-primary truncate mb-1">
        {s.title}
      </div>
      {s.description && (
        <div className="text-caption text-text-tertiary truncate">{s.description}</div>
      )}
      <div className="text-[11px] text-text-tertiary mt-2 flex items-center gap-2">
        <span>작성 {s.author_name || `#${s.id}`}</span>
        {s.is_anonymous && (
          <span className="inline-flex items-center gap-0.5">
            <Lock size={9} /> 익명
          </span>
        )}
      </div>
    </Link>
  );
}


function CreateSurveyModal({
  cid, onClose, onCreated,
}: { cid: number; onClose: () => void; onCreated: (sid: number) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [allowMulti, setAllowMulti] = useState(false);
  const [accessMode, setAccessMode] = useState<"course_members" | "link_public">("course_members");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return alert("제목을 입력하세요");
    setSaving(true);
    try {
      const res = await api.post<{ id: number }>("/api/classroom/surveys", {
        title: title.trim(),
        description: description.trim() || null,
        course_id: cid,
        is_anonymous: isAnonymous,
        allow_multiple_responses: allowMulti,
        access_mode: accessMode,
      });
      onCreated(res.id);
    } catch (e: any) {
      alert(e?.detail || "생성 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold">새 설문</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-caption text-text-secondary block mb-1">제목 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 5월 수업 이해도 점검"
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="text-caption text-text-secondary block mb-1">설명 (선택)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary resize-y"
            />
          </div>
          <label className="flex items-center gap-2 text-caption cursor-pointer">
            <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
            익명 응답 (응답자 ID 저장 X)
          </label>
          <label className="flex items-center gap-2 text-caption cursor-pointer">
            <input type="checkbox" checked={allowMulti} onChange={(e) => setAllowMulti(e.target.checked)} />
            한 사람이 여러 번 응답 허용
          </label>
          <div>
            <label className="text-caption text-text-secondary block mb-1">공유 모드</label>
            <select
              value={accessMode}
              onChange={(e) => setAccessMode(e.target.value as any)}
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              <option value="course_members">강좌 멤버만</option>
              <option value="link_public">링크 공유 (인증 사용자 누구나)</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border-default">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-caption border border-border-default rounded"
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded disabled:opacity-50"
          >
            <Plus size={12} /> {saving ? "생성 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
