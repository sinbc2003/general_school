"use client";

import { Loader2, AlertCircle } from "lucide-react";
import type { ToolJob } from "./_useToolJob";

/** 진행 중 / 실패 상태 카드 (완료 결과는 각 페이지가 직접 렌더). */
export function JobStatusCard({ job }: { job: ToolJob }) {
  if (job.status === "failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-2 text-sm">
        <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
        <div className="min-w-0">
          <div className="font-semibold text-red-700">작업 실패</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-red-600 text-[13px]">
            {job.error || "알 수 없는 오류"}
          </div>
        </div>
      </div>
    );
  }
  if (job.status === "completed") return null;

  return (
    <div className="rounded-lg border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 text-sm text-text-primary">
        <Loader2 size={16} className="animate-spin text-accent" />
        <span>{job.stage || "처리 중"}…</span>
        <span className="ml-auto text-text-tertiary tabular-nums">{job.progress}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-bg-primary overflow-hidden border border-border-default/50">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${Math.max(5, job.progress)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-text-tertiary">
        진행되는 동안 이 페이지를 닫아도 됩니다 — 아래 “최근 작업”에서 다시 확인할 수 있어요.
      </p>
    </div>
  );
}
