"use client";

/**
 * 학생용 "내 문서" — 단독(course_id=null) 협업 문서 + 공유받은 문서.
 *
 * Google Drive 식 개인 저장소는 정책상 별도 시스템 만들지 않고,
 * 협업 문서 모델의 course_id=null + DocumentMember 공유 시스템 활용.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Pencil } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";

interface DocItem {
  id: number;
  course_id: number | null;
  owner_id: number;
  owner_name?: string;
  title: string;
  access_mode: string;
  is_archived: boolean;
  updated_at: string | null;
}

export default function StudentMyDocsPage() {
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 전체 문서 (course 무관) — 본인이 owner이거나 멤버
      const d = await api.get<{ items: DocItem[] }>("/api/classroom/docs");
      setDocs(d.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createDoc = async () => {
    setCreating(true);
    try {
      const d = await api.post<DocItem>("/api/classroom/docs", {
        title: newTitle.trim() || "제목 없음",
        course_id: null,
        access_mode: "specific_users",
      });
      toast.show("문서 생성됨", "success");
      // 학생의 단독 문서는 강좌가 없으니 가장 가까운 강좌 ID를 URL에 두지 않고
      // 별도 "내 문서 편집기" path가 이상적이지만, 기존 강좌 path와 분리하면
      // 페이지 중복 → 학생 본인 강좌 중 임의 1개로 navigate.
      // 더 깔끔히 하려면 /s/docs/[did] 별도 라우트 — 향후 별 commit.
      // 지금은 단순: 직접 모달 미오픈, 목록에서 클릭 유도.
      setNewTitle("");
      await load();
      // 새 문서로 즉시 이동 — /s/docs/[did]
      router.push(`/s/docs/${d.id}`);
    } catch (e: any) {
      toast.show(e?.detail || "생성 실패", "error");
    } finally {
      setCreating(false);
    }
  };

  // 단독 문서만 (course_id=null)
  const standalone = docs.filter((d) => !d.course_id);
  const courseDocs = docs.filter((d) => d.course_id);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title text-text-primary flex items-center gap-2">
          <FileText size={22} /> 내 문서
        </h1>
        <p className="text-caption text-text-tertiary mt-1">
          본인이 만든 단독 문서 + 공유받은 문서. 강좌 안 문서는 "내 수업"의 각 강좌에서 봅니다.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="새 문서 제목 (선택)"
          className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary w-64"
        />
        <button
          onClick={createDoc}
          disabled={creating}
          className="flex items-center gap-1 px-4 py-2 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Plus size={14} /> {creating ? "생성 중..." : "새 문서"}
        </button>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : standalone.length === 0 && courseDocs.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <FileText size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary mb-1">아직 문서가 없습니다</div>
          <div className="text-caption text-text-tertiary">
            위 [새 문서] 버튼으로 단독 문서를 만들거나, 강좌의 협업 문서에 참여하세요.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {standalone.length > 0 && (
            <Section title="내 단독 문서" docs={standalone} baseHref="/s/docs" />
          )}
          {courseDocs.length > 0 && (
            <Section
              title="강좌 협업 문서 (참여 중)"
              docs={courseDocs}
              baseHref="/s/classroom"
              hint="각 강좌의 협업 문서. 클릭하면 해당 강좌로 이동."
            />
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title, docs, baseHref, hint,
}: { title: string; docs: DocItem[]; baseHref: string; hint?: string }) {
  return (
    <div>
      <div className="text-caption text-text-secondary font-semibold mb-2 flex items-center gap-2">
        {title}
        {hint && <span className="text-[11px] text-text-tertiary font-normal">— {hint}</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {docs.map((d) => (
          <Link
            key={d.id}
            href={
              d.course_id
                ? `${baseHref}/${d.course_id}/docs/${d.id}`
                : `${baseHref}/${d.id}`
            }
            className="group border border-border-default rounded-lg p-4 hover:border-accent hover:shadow-sm transition bg-bg-primary"
          >
            <div className="flex items-start justify-between mb-2">
              <FileText size={16} className="text-accent flex-shrink-0 mt-0.5" />
              <Pencil size={12} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
            </div>
            <div className="text-body font-medium text-text-primary truncate mb-1">
              {d.title}
            </div>
            <div className="text-caption text-text-tertiary truncate">
              만든이 {d.owner_name || `#${d.owner_id}`}
            </div>
            <div className="text-[11px] text-text-tertiary mt-2">
              수정 {d.updated_at?.slice(0, 16).replace("T", " ")}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
