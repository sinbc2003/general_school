"use client";

/**
 * 강좌 협업 문서 목록 (관리자·교사·학생 공용).
 *
 * - 강좌 멤버이면 모두 열람. 교사·관리자만 새 문서 생성.
 * - 클릭하면 [did]/page.tsx 편집기로.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, Plus, Archive, Pencil } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

interface CourseDetail {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  teacher_id: number;
  viewer_role: "admin" | "teacher" | "student";
}

interface DocItem {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  access_mode: string;
  is_archived: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export default function CourseDocsPage() {
  const params = useParams();
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const cid = Number(params.cid);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const canCreate = course
    ? course.viewer_role === "teacher" || course.viewer_role === "admin"
    : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, d] = await Promise.all([
        api.get<CourseDetail>(`/api/classroom/courses/${cid}`),
        api.get<{ items: DocItem[] }>(
          `/api/classroom/docs?course_id=${cid}&include_archived=${includeArchived}`,
        ),
      ]);
      setCourse(c);
      setDocs(d.items);
    } catch (e: any) {
      alert(e?.detail || "문서 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [cid, includeArchived]);

  useEffect(() => { load(); }, [load]);

  const createDoc = async () => {
    const title = (newTitle || "제목 없음").trim();
    setCreating(true);
    try {
      const d = await api.post<DocItem>("/api/classroom/docs", {
        title,
        course_id: cid,
        access_mode: "course_members",
      });
      router.push(`/classroom/${cid}/docs/${d.id}`);
    } catch (e: any) {
      alert(e?.detail || "생성 실패");
      setCreating(false);
    }
  };

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
          <FileText size={20} /> 협업 문서
        </h1>
        <div className="text-caption text-text-tertiary mt-1">
          강좌 멤버가 함께 실시간 편집할 수 있는 Google Docs 식 협업 문서입니다.
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 text-caption text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <Archive size={12} /> 보관된 문서 포함
        </label>
        {canCreate && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="새 문서 제목 (선택)"
              className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary w-48"
            />
            <button
              onClick={createDoc}
              disabled={creating}
              className="flex items-center gap-1 px-3 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
            >
              <Plus size={12} /> {creating ? "생성 중..." : "새 문서"}
            </button>
          </div>
        )}
      </div>

      {docs.length === 0 ? (
        <div className="text-caption text-text-tertiary py-12 text-center border border-dashed border-border-default rounded">
          아직 협업 문서가 없습니다.
          {canCreate && " 위 [새 문서] 버튼으로 만들어보세요."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map((d) => (
            <Link
              key={d.id}
              href={`/classroom/${cid}/docs/${d.id}`}
              className={`group border border-border-default rounded-lg p-4 hover:border-accent hover:shadow-sm transition ${
                d.is_archived ? "bg-bg-secondary opacity-75" : "bg-bg-primary"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <FileText size={16} className="text-accent flex-shrink-0 mt-0.5" />
                <Pencil size={12} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
              </div>
              <div className="text-body font-medium text-text-primary truncate mb-1">
                {d.title}
              </div>
              <div className="text-caption text-text-tertiary truncate">
                작성자 {d.owner_name || `#${d.owner_id}`}
              </div>
              <div className="text-[11px] text-text-tertiary mt-2">
                수정 {d.updated_at?.slice(0, 16).replace("T", " ")}
                {d.is_archived && (
                  <span className="ml-2 px-1.5 py-0.5 bg-cream-200 rounded text-text-secondary">
                    보관
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {isSuperAdmin && (
        <div className="mt-6 text-[11px] text-text-tertiary border-t border-border-default pt-3">
          (관리자 안내) 실시간 동시 편집은 Hocuspocus 서버(포트 1234)가 실행 중이어야
          작동합니다. SETUP.md → 협업 문서 운영 절차 참조.
        </div>
      )}
    </div>
  );
}
