"use client";

/** PDF 번역 도구 (PyMuPDF 텍스트 추출 + 플랫폼 LLM 번역). */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Languages, Upload, Download, CheckCircle2, AlertTriangle, ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";
import { useToolJob } from "../_useToolJob";
import { JobStatusCard } from "../_JobStatusCard";
import { RecentJobs } from "../_RecentJobs";

export default function TranslatePage() {
  const { job, submitting, error, submit } = useToolJob();
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState("ko");
  const [sourceLang, setSourceLang] = useState("");
  const [ready, setReady] = useState<{ llm_configured: boolean; languages: Record<string, string> } | null>(null);
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
    fd.append("target_lang", targetLang);
    fd.append("source_lang", sourceLang);
    submit("/api/tools/office/translate", fd);
  };

  const busy = submitting || (job ? job.status === "pending" || job.status === "running" : false);
  const langs = ready?.languages || { ko: "한국어", en: "영어(English)" };
  const noLlm = ready && !ready.llm_configured;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/tools/work" className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-3">
        <ArrowLeft size={14} /> 업무 도구
      </Link>
      <header className="mb-5 flex items-center gap-2">
        <Languages size={22} className="text-teal-600" />
        <div>
          <h1 className="text-title font-semibold">PDF 번역</h1>
          <p className="text-caption text-text-tertiary">
            PDF의 텍스트를 페이지별로 추출해 번역합니다 (학교에 등록된 AI 모델 사용).
          </p>
        </div>
      </header>

      {noLlm && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800 flex gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            사용 가능한 AI 모델이 없습니다. 관리자가{" "}
            <Link href="/system/llm/providers" className="underline font-medium">
              시스템 → LLM Provider
            </Link>{" "}
            에서 API 키를 등록·활성화해야 번역할 수 있습니다.
          </span>
        </div>
      )}

      <div className="border border-border-default rounded-xl bg-bg-primary p-5 space-y-4">
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
            <div className="text-sm text-text-secondary">PDF 파일 선택 (텍스트 PDF, 최대 50MB)</div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] text-text-secondary">
            원문 언어
            <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-[13px] border border-border-default rounded bg-bg-primary">
              <option value="">자동 감지</option>
              {Object.entries(langs).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-text-secondary">
            번역 언어
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-[13px] border border-border-default rounded bg-bg-primary">
              {Object.entries(langs).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </label>
        </div>

        <button
          onClick={start}
          disabled={!file || busy || !!noLlm}
          className="w-full px-4 py-2.5 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "번역 중…" : "번역 시작"}
        </button>

        <p className="text-[11px] text-text-tertiary">
          ※ 스캔(이미지) PDF는 텍스트가 없어 번역되지 않습니다. 텍스트가 포함된 PDF만 가능합니다.
          페이지 수에 따라 수 분 걸릴 수 있어요.
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
                <CheckCircle2 size={16} /> 번역 완료
                <span className="ml-auto font-normal text-[12px] text-emerald-700">
                  {job.result_meta?.page_count ? `${job.result_meta.page_count}쪽` : ""}
                  {job.result_meta?.target_lang_label ? ` · ${job.result_meta.target_lang_label}` : ""}
                </span>
              </div>
              <button
                onClick={() => downloadSecure(job.output_file_url!, `${job.title || "번역"}_번역.txt`)}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:opacity-90"
              >
                <Download size={15} /> 번역문(.txt) 다운로드
              </button>
              {job.result_meta?.text && (
                <div className="mt-3">
                  <div className="text-[12px] text-text-tertiary mb-1">미리보기</div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed bg-bg-primary border border-border-default rounded-lg p-3 text-text-primary">
                    {job.result_meta.text}
                  </pre>
                  {job.result_meta?.text_truncated && (
                    <p className="mt-1 text-[11px] text-text-tertiary">
                      … 미리보기가 길어 일부만 표시됩니다. 전체는 파일을 다운로드하세요.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <RecentJobs tool="pdf_translate" refreshKey={refreshKey} />
    </div>
  );
}
