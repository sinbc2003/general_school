"use client";

/**
 * CSV 일괄 등록 모달 (최고관리자 전용).
 *
 * role 선택 → 템플릿 다운로드 → CSV 업로드 (검증 dry-run / 실행).
 */

import { useState } from "react";
import { AlertCircle, FileText, Upload, X } from "lucide-react";
import { api } from "@/lib/api/client";


type CsvRole = "designated_admin" | "teacher" | "student";

const ROLE_INFO: Record<CsvRole, { label: string; desc: string; cols: string }> = {
  designated_admin: {
    label: "지정관리자",
    desc: "권한 관리·사용자 등록 등 super_admin과 거의 동일한 권한",
    cols: "name, email, username, password",
  },
  teacher: {
    label: "교사",
    desc: "수업·학생 지도용. 학생 데이터 조회 가능",
    cols: "name, email, username, password, department",
  },
  student: {
    label: "학생",
    desc: "본인 포트폴리오·진로·챗봇 사용",
    cols: "name, email, username, password, grade, class_number, student_number",
  },
};


export function CsvBulkImportModal({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<CsvRole>("student");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const downloadTemplate = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002"}/api/users/_csv/template/${role}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      alert("템플릿 다운로드 실패");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `users_${role}_template.xlsx`;
    a.click();
  };

  const upload = async (dryRun: boolean) => {
    if (!file) return alert("CSV 파일을 선택하세요");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.fetch<any>(`/api/users/_csv/import/${role}?dry_run=${dryRun}`, {
        method: "POST",
        body: fd,
      });
      setResult(r);
    } catch (e: any) {
      alert(e?.detail || "업로드 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold text-text-primary">엑셀 일괄 등록 (최고관리자 전용)</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-body font-medium text-text-primary mb-2">역할 선택</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(Object.keys(ROLE_INFO) as Array<keyof typeof ROLE_INFO>).map((r) => (
                <button
                  key={r}
                  onClick={() => { setRole(r); setResult(null); setFile(null); }}
                  className={`text-left p-3 border rounded-lg ${role === r ? "border-accent bg-accent-light" : "border-border-default hover:bg-bg-secondary"}`}
                >
                  <div className="text-body font-medium">{ROLE_INFO[r].label}</div>
                  <div className="text-caption text-text-tertiary mt-0.5">{ROLE_INFO[r].desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-bg-secondary rounded p-3">
            <div className="text-caption text-text-secondary mb-1">CSV 컬럼 (헤더 첫 줄):</div>
            <code className="text-caption text-text-primary">{ROLE_INFO[role].cols}</code>
            <div className="text-caption text-text-tertiary mt-2">
              · 필수: name, email, username
              <br />· password 미입력 시 기본값 사용 + 첫 로그인 시 변경 강제
              <br />· UTF-8 (Excel에서 저장 시 "CSV UTF-8" 선택)
            </div>
          </div>

          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1 px-3 py-1.5 border border-border-default rounded text-body hover:bg-bg-secondary"
          >
            <FileText size={14} /> {ROLE_INFO[role].label} 템플릿 다운로드 (예시 1행 포함)
          </button>

          <div>
            <label className="block text-body font-medium text-text-primary mb-1">CSV 파일</label>
            <input
              type="file"
              accept=".xlsx,.csv,text/csv"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
              className="block w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => upload(true)}
              disabled={!file || busy}
              className="flex-1 px-4 py-2 border border-border-default rounded text-body disabled:opacity-50"
            >
              검증만 (dry-run)
            </button>
            <button
              onClick={() => upload(false)}
              disabled={!file || busy}
              className="flex-1 flex items-center justify-center gap-1 px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50"
            >
              <Upload size={14} /> 업로드 실행
            </button>
          </div>

          {result && (
            <div className="bg-bg-secondary rounded p-3 mt-2">
              <div className="flex items-center gap-2 mb-2">
                {result.errors?.length === 0
                  ? <span className="text-status-success font-medium">✓ {result.dry_run ? "검증 성공" : "등록 완료"}</span>
                  : <AlertCircle size={16} className="text-status-warning" />}
                <span className="text-body">
                  성공 <strong>{result.ok_count}</strong>건 · 실패 <strong>{result.errors?.length || 0}</strong>건
                </span>
              </div>
              {result.errors?.length > 0 && (
                <div className="max-h-48 overflow-y-auto text-caption space-y-0.5">
                  {result.errors.slice(0, 80).map((e: any, i: number) => (
                    <div key={i}>
                      <span className="text-text-tertiary">행 {e.row}:</span> {e.error}
                    </div>
                  ))}
                  {result.errors.length > 80 && (
                    <div className="text-text-tertiary">... 외 {result.errors.length - 80}건</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
