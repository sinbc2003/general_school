"use client";

/**
 * 공통 CSV 업로드 컴포넌트 — 양식 다운로드 + 파일 선택 + dry-run/실제 반영 + 결과 표시.
 *
 * 사용 예:
 *   <CsvUploader
 *     onTemplateDownload={() => downloadTemplate("teacher")}
 *     onUpload={(file, dryRun) => apiUpload(file, dryRun)}
 *     description="이름이 자동으로 아이디가 됩니다..."
 *   />
 */

import { useState, type ReactNode } from "react";
import { AlertCircle, Download } from "lucide-react";

export interface CsvUploadResult {
  ok_count: number;
  errors?: Array<{ row: number; error: string }>;
  dry_run: boolean;
  /** import 모듈마다 다른 추가 필드 (created_users, enrolled 등) */
  [key: string]: any;
}

interface CsvUploaderProps {
  /** 양식 다운로드 콜백 (제공하지 않으면 다운로드 버튼 숨김) */
  onTemplateDownload?: () => Promise<void> | void;
  /** 업로드 실행 콜백 */
  onUpload: (file: File, dryRun: boolean) => Promise<CsvUploadResult>;
  /** 실제 반영 성공 시 호출 (목록 갱신 등) */
  onSuccess?: () => void;
  /** 설명 박스 내용 (info note) */
  description?: ReactNode;
  /** 결과 표시에 추가로 보여줄 행 */
  renderExtraMetrics?: (result: CsvUploadResult) => ReactNode;
}

export function CsvUploader({
  onTemplateDownload,
  onUpload,
  onSuccess,
  description,
  renderExtraMetrics,
}: CsvUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvUploadResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    if (!file) {
      alert("파일을 선택하세요");
      return;
    }
    setBusy(true);
    try {
      const data = await onUpload(file, dryRun);
      setResult(data);
      if (!dryRun && onSuccess) onSuccess();
    } catch (err: any) {
      alert(err?.message || err?.detail || "업로드 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {description && (
        <div className="p-3 bg-cream-100 border border-cream-300 rounded text-caption text-text-secondary">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-accent" />
            <div>{description}</div>
          </div>
        </div>
      )}

      {onTemplateDownload && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => onTemplateDownload()}
            className="inline-flex items-center gap-1 text-caption text-accent hover:underline"
          >
            <Download size={14} /> 양식 다운로드
          </button>
        </div>
      )}

      <div>
        <label className="block text-caption text-text-secondary mb-1">
          CSV 파일 (UTF-8) *
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult(null);
          }}
          className="w-full text-body"
        />
        {file && (
          <div className="text-caption text-text-tertiary mt-1">
            선택: {file.name} ({Math.round(file.size / 1024)} KB)
          </div>
        )}
      </div>

      {result && (
        <div
          className={`p-3 rounded border ${
            result.dry_run
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200"
          }`}
        >
          <div className="text-caption flex items-center gap-2 mb-1">
            <AlertCircle size={14} />
            {result.dry_run ? "미리보기 (아직 반영 안 됨)" : "반영 결과"}
          </div>
          <div className="text-body text-text-primary">
            성공 <b>{result.ok_count}</b>
            {renderExtraMetrics && renderExtraMetrics(result)}
          </div>
          {result.errors && result.errors.length > 0 && (
            <div className="mt-2">
              <div className="text-caption text-status-error mb-1">
                오류 {result.errors.length}건:
              </div>
              <div className="text-caption text-text-secondary max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <div key={i}>
                    행 {e.row}: {e.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => run(true)}
          disabled={busy || !file}
          className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
        >
          미리보기 (dry-run)
        </button>
        <button
          onClick={() => run(false)}
          disabled={busy || !file || !result}
          className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          title={!result ? "먼저 미리보기를 실행하세요" : ""}
        >
          {busy ? "처리 중..." : "실제 반영"}
        </button>
      </div>
    </div>
  );
}
