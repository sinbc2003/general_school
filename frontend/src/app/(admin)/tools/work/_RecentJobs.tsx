"use client";

/** 최근 작업 목록 (도구별) — 상태 배지 + 다운로드 + 삭제. */

import { useCallback, useEffect, useState } from "react";
import { Download, Trash2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";
import type { ToolJob } from "./_useToolJob";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "대기", cls: "bg-slate-100 text-slate-600" },
  running: { label: "진행 중", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "완료", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "실패", cls: "bg-red-100 text-red-700" },
};

function fileName(job: ToolJob): string {
  const base = (job.title || "결과").replace(/[\\/:*?"<>|]/g, "_");
  const ext = job.result_meta?.output_ext || "bin";
  return job.tool === "pdf_translate" ? `${base}_번역.${ext}` : `${base}.${ext}`;
}

export function RecentJobs({ tool, refreshKey }: { tool: string; refreshKey: number }) {
  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: ToolJob[] }>(`/api/tools/office/jobs?tool=${tool}`);
      setJobs(r.items || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [tool]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const remove = async (id: number) => {
    if (!confirm("이 작업과 결과 파일을 삭제할까요?")) return;
    try {
      await api.delete(`/api/tools/office/jobs/${id}`);
      setJobs((j) => j.filter((x) => x.id !== id));
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  if (loading) return null;
  if (jobs.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-body font-semibold text-text-primary">최근 작업</h2>
        <button
          onClick={load}
          className="text-text-tertiary hover:text-text-primary"
          title="새로고침"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="border border-border-default rounded-lg divide-y divide-border-default/70 overflow-hidden">
        {jobs.map((j) => {
          const badge = STATUS_BADGE[j.status] || STATUS_BADGE.pending;
          return (
            <div key={j.id} className="flex items-center gap-3 px-3 py-2.5 bg-bg-primary text-sm">
              <span className={`text-[11px] px-1.5 py-0.5 rounded ${badge.cls}`}>
                {j.status === "running" ? `${j.progress}%` : badge.label}
              </span>
              <span className="flex-1 truncate text-text-primary" title={j.input_filename || ""}>
                {j.title || j.input_filename || `작업 #${j.id}`}
              </span>
              {j.status === "completed" && j.output_file_url && (
                <button
                  onClick={() => downloadSecure(j.output_file_url!, fileName(j))}
                  className="flex items-center gap-1 text-accent hover:underline text-[12px]"
                >
                  <Download size={13} /> 다운로드
                </button>
              )}
              <button
                onClick={() => remove(j.id)}
                className="text-text-tertiary hover:text-red-500"
                title="삭제"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
