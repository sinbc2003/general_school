"use client";

/** PDF → HWPX 변환 도구 (Mathpix OCR + 벤더 pdf2hwpx 엔진). */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FileType2, Upload, Download, CheckCircle2, AlertTriangle, ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";
import { useToolJob } from "../_useToolJob";
import { JobStatusCard } from "../_JobStatusCard";
import { RecentJobs } from "../_RecentJobs";

export default function PdfHwpxPage() {
  const { job, submitting, error, submit } = useToolJob();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("hybrid");
  const [docType, setDocType] = useState("exam");
  const [columns, setColumns] = useState("1");
  const [ready, setReady] = useState<{ mathpix_configured: boolean; mathpix_enabled: boolean } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/api/tools/office/status").then(setReady).catch(() => setReady(null));
  }, []);

  useEffect(() => {
    if (job && (job.status === "completed" || job.status === "failed")) {
      setRefreshKey((k) => k + 1);
    }
  }, [job?.status]);

  const start = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    fd.append("doc_type", docType);
    fd.append("columns", columns);
    submit("/api/tools/office/pdf2hwpx", fd);
  };

  const busy = submitting || (job ? job.status === "pending" || job.status === "running" : false);
  const notConfigured = ready && !ready.mathpix_configured;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/tools/work" className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-3">
        <ArrowLeft size={14} /> 업무 도구
      </Link>
      <header className="mb-5 flex items-center gap-2">
        <FileType2 size={22} className="text-blue-600" />
        <div>
          <h1 className="text-title font-semibold">PDF → HWPX 변환</h1>
          <p className="text-caption text-text-tertiary">
            PDF(특히 수학 시험지)를 한글 문서로 — 수식은 한컴 수식으로 인식됩니다.
          </p>
        </div>
      </header>

      {notConfigured && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800 flex gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            Mathpix API 키가 설정되지 않았습니다. 관리자가{" "}
            <Link href="/system/integrations/mathpix" className="underline font-medium">
              시스템 → PDF 도구(Mathpix)
            </Link>{" "}
            에서 키를 등록해야 변환할 수 있습니다.
          </span>
        </div>
      )}

      <div className="border border-border-default rounded-xl bg-bg-primary p-5 space-y-4">
        {/* 파일 선택 */}
        <div
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border-default rounded-lg p-6 text-center cursor-pointer hover:border-accent transition"
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <Upload size={22} className="mx-auto text-text-tertiary mb-1.5" />
          {file ? (
            <div className="text-sm text-text-primary font-medium">{file.name}</div>
          ) : (
            <div className="text-sm text-text-secondary">PDF 파일 선택 (최대 50MB)</div>
          )}
        </div>

        {/* 옵션 */}
        <div className="grid grid-cols-3 gap-3">
          <label className="text-[12px] text-text-secondary">
            변환 모드
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-[13px] border border-border-default rounded bg-bg-primary">
              <option value="hybrid">하이브리드(권장)</option>
              <option value="image">이미지</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <label className="text-[12px] text-text-secondary">
            문서 유형
            <select value={docType} onChange={(e) => setDocType(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-[13px] border border-border-default rounded bg-bg-primary">
              <option value="exam">시험지(문항)</option>
              <option value="general">일반 문서</option>
            </select>
          </label>
          <label className="text-[12px] text-text-secondary">
            단 수
            <select value={columns} onChange={(e) => setColumns(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-[13px] border border-border-default rounded bg-bg-primary">
              <option value="1">1단</option>
              <option value="2">2단</option>
            </select>
          </label>
        </div>

        <button
          onClick={start}
          disabled={!file || busy || !!notConfigured}
          className="w-full px-4 py-2.5 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "변환 중…" : "변환 시작"}
        </button>

        <p className="text-[11px] text-text-tertiary">
          ※ Mathpix OCR로 수식을 인식합니다. 페이지 수에 따라 수십 초~수 분 걸릴 수 있어요.
          수식 크기 미세 보정(한/글 후처리)은 변환된 HWPX를 한/글에서 열면 자동 적용됩니다.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>
      )}

      {job && (
        <div className="mt-4">
          <JobStatusCard job={job} />
          {job.status === "completed" && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                <CheckCircle2 size={16} /> 변환 완료
              </div>
              <div className="mt-1 text-[12px] text-emerald-700">
                {job.result_meta?.total_pages ? `${job.result_meta.total_pages}쪽 처리` : ""}
                {job.result_meta?.failed_pages?.length
                  ? ` · 실패 ${job.result_meta.failed_pages.length}쪽` : ""}
              </div>
              {Array.isArray(job.result_meta?.warnings) && job.result_meta.warnings.length > 0 && (
                <ul className="mt-2 text-[12px] text-amber-700 list-disc pl-5 space-y-0.5">
                  {job.result_meta.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                </ul>
              )}
              <button
                onClick={() => downloadSecure(job.output_file_url!, `${job.title || "변환"}.hwpx`)}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:opacity-90"
              >
                <Download size={15} /> HWPX 다운로드
              </button>
            </div>
          )}
        </div>
      )}

      <RecentJobs tool="pdf2hwpx" refreshKey={refreshKey} />
    </div>
  );
}
