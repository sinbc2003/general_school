"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, RefreshCw, Users } from "lucide-react";
import { api } from "@/lib/api/client";

interface StudentRow {
  id: number;
  student_id: number;
  name: string;
  display_order: number;
  is_published: boolean;
  final_text: string | null;
}

interface ProjectDetail {
  id: number;
  name: string;
  scope_type: string;
  students: StudentRow[];
}

export default function RecordProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pid = params.id as string;
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/record-writer/projects/${pid}`);
      setData(d);
    } catch (e) {
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setSyncing(true);
    try {
      const r = await api.post(`/api/record-writer/projects/${pid}/refresh-students`, {});
      await load();
      alert(`${r.added}명 추가됨 (총 ${r.total}명)`);
    } catch (e: any) {
      alert(`동기화 실패: ${e?.detail || e}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 size={20} className="animate-spin mx-auto text-text-tertiary" />
      </div>
    );
  }
  if (!data) {
    return <div className="p-12 text-center text-text-tertiary">프로젝트를 불러올 수 없습니다.</div>;
  }

  return (
    <div>
      <button
        onClick={() => router.push("/record-writer")}
        className="text-caption text-text-tertiary inline-flex items-center gap-1 mb-3 hover:text-text-primary"
      >
        <ArrowLeft size={14} /> 목록
      </button>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-title text-text-primary">{data.name}</h1>
        <button
          onClick={refresh}
          disabled={syncing}
          className="px-3 py-1.5 border border-border-default rounded text-caption inline-flex items-center gap-1 disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 학생 동기화
        </button>
      </div>

      {/* Phase 2: 항목(열) × 학생(행) 매트릭스가 여기에 들어갑니다. 현재는 대상 학생 목록. */}
      <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-bg-secondary border-b border-border-default text-caption text-text-tertiary inline-flex items-center gap-1">
          <Users size={14} /> 대상 학생 {data.students?.length ?? 0}명
        </div>
        {(data.students || []).length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-caption">
            대상 학생이 없습니다. &quot;학생 동기화&quot;를 눌러보세요.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-bg-secondary border-b border-border-default text-caption text-text-tertiary">
              <tr>
                <th className="text-left px-3 py-2 w-12">#</th>
                <th className="text-left px-3 py-2">이름</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s, i) => (
                <tr key={s.id} className="border-b border-border-default last:border-0">
                  <td className="px-3 py-2 text-caption text-text-tertiary">{i + 1}</td>
                  <td className="px-3 py-2 text-body text-text-primary">{s.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-caption text-text-tertiary mt-3">
        항목 추가 · AI 작성 · 맞춤법 · 유사도는 다음 단계에서 제공됩니다.
      </p>
    </div>
  );
}
