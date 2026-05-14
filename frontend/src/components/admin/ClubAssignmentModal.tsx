"use client";

import { useState } from "react";
import { Upload, Download, Users } from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface Props {
  show: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

interface ImportResult {
  semester_id?: number;
  added?: number;
  skipped_already_member?: number;
  errors?: { row: number; error: string }[];
  total_rows?: number;
  applied?: boolean;
  error?: string;
}

export function ClubAssignmentModal({ show, onClose, onApplied }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (!show) return null;

  const downloadTemplate = () => {
    window.location.href = `${API_URL}/api/club/_assignments/csv-template`;
  };

  const submit = async (dry_run: boolean) => {
    if (!file) {
      alert("CSV 파일을 선택하세요");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = `/api/club/_assignments/import?dry_run=${dry_run}`;
      const r = (await api.fetch(url, { method: "POST", body: fd })) as ImportResult;
      setResult(r);
      if (!dry_run && r.applied) onApplied?.();
    } catch (e: any) {
      setResult({ error: e?.detail || e?.message || "업로드 실패" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg max-w-xl w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-title text-text-primary flex items-center gap-2">
            <Users size={18} className="text-accent" /> 학생 동아리 일괄 배정 (CSV)
          </h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">✕</button>
        </div>
        <p className="text-caption text-text-secondary mb-3">
          CSV 형식: <code className="bg-bg-secondary px-1 rounded">student_number, name, club_name</code>.
          학번 우선, 없으면 이름으로 매칭. 한 학생이 여러 동아리 가입은 행 여러 줄.
          현재 학기의 동아리에만 매칭됩니다.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded"
          >
            <Download size={13} /> 템플릿 다운로드
          </button>
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult(null);
          }}
          className="w-full text-body mb-3"
        />
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => submit(true)}
            disabled={busy || !file}
            className="px-3 py-1.5 bg-bg-secondary border border-border-default text-body rounded disabled:opacity-40"
          >
            검증만 (dry-run)
          </button>
          <button
            onClick={() => submit(false)}
            disabled={busy || !file}
            className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-body rounded disabled:opacity-40"
          >
            <Upload size={14} /> 실제 적용
          </button>
        </div>
        {result && (
          <div
            className={`p-3 rounded text-caption ${
              result.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"
            }`}
          >
            {result.error ? (
              <div>실패: {result.error}</div>
            ) : (
              <>
                <div>
                  총 {result.total_rows}행 · 추가 {result.added} · 이미 가입{" "}
                  {result.skipped_already_member}
                  {result.applied ? " · ✓ 적용됨" : " · (dry-run, 적용 안 됨)"}
                </div>
                {result.errors && result.errors.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium">에러 {result.errors.length}건:</div>
                    <ul className="list-disc list-inside max-h-32 overflow-y-auto">
                      {result.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>행 {e.row}: {e.error}</li>
                      ))}
                      {result.errors.length > 20 && (
                        <li>... 외 {result.errors.length - 20}건</li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
