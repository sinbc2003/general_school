"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, Download, ArrowLeft, AlertCircle, Check } from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

const TYPES = [
  { key: "grades", label: "성적", desc: "지필평가 (중간/기말)" },
  { key: "awards", label: "수상", desc: "교내/교외 수상 기록" },
  { key: "mockexam", label: "모의고사", desc: "모의고사 성적" },
  { key: "counseling", label: "상담", desc: "상담 기록" },
  { key: "records", label: "생기부", desc: "행동특성, 자율, 동아리, 진로 등" },
];

export default function ImportPage() {
  const [type, setType] = useState("grades");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const downloadTemplate = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";
    const res = await fetch(`${API_URL}/api/students/_io/csv-template/${type}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `template_${type}.csv`;
    a.click();
  };

  const upload = async (dryRun: boolean) => {
    if (!file) return alert("파일을 선택하세요");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.fetch(`/api/students/_io/import/${type}?dry_run=${dryRun}`, {
        method: "POST", body: fd,
      });
      setResult(res);
    } catch (e: any) {
      alert(e?.detail || "업로드 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <Link href="/students" className="flex items-center gap-1 text-caption text-text-secondary hover:text-accent mb-4">
        <ArrowLeft size={14} /> 학생 현황으로
      </Link>
      <h1 className="text-title text-text-primary mb-2">CSV 일괄 업로드</h1>
      <p className="text-caption text-text-tertiary mb-6">
        포트폴리오 데이터를 CSV로 일괄 등록합니다. 양식은 우측 다운로드 버튼으로 받을 수 있습니다 (UTF-8 BOM 포함, Excel에서 한글 깨지지 않음).
      </p>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5 space-y-4">
        <div>
          <label className="text-body font-medium text-text-primary mb-2 block">데이터 종류</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => { setType(t.key); setResult(null); }}
                className={`text-left p-3 border rounded-lg ${type === t.key ? "border-accent bg-accent-light" : "border-border-default hover:bg-bg-secondary"}`}
              >
                <div className="text-body font-medium">{t.label}</div>
                <div className="text-caption text-text-tertiary mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={downloadTemplate} className="flex items-center gap-1 px-3 py-2 border border-border-default rounded text-body hover:bg-bg-secondary">
            <Download size={14} /> {TYPES.find((t) => t.key === type)?.label} 템플릿 다운로드
          </button>
        </div>

        <div>
          <label className="text-body font-medium text-text-primary mb-2 block">CSV 파일</label>
          <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
                 className="block w-full px-3 py-2 border border-border-default rounded text-body" />
        </div>

        <div className="flex gap-2">
          <button onClick={() => upload(true)} disabled={!file || loading}
                  className="flex items-center gap-1 px-4 py-2 border border-border-default rounded text-body disabled:opacity-50">
            검증만 (dry-run)
          </button>
          <button onClick={() => upload(false)} disabled={!file || loading}
                  className="flex items-center gap-1 px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50">
            <Upload size={14} /> 업로드 실행
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-6 bg-bg-primary border border-border-default rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            {result.errors?.length === 0 ? (
              <Check size={20} className="text-status-success" />
            ) : (
              <AlertCircle size={20} className="text-status-warning" />
            )}
            <h2 className="text-body font-semibold">
              {result.dry_run ? "검증 결과" : "업로드 완료"}
            </h2>
          </div>
          <div className="text-body">
            <div>✓ 성공: <strong>{result.ok_count}</strong>건</div>
            <div className="text-status-warning">⚠ 실패: <strong>{result.errors?.length || 0}</strong>건</div>
          </div>
          {result.errors?.length > 0 && (
            <div className="mt-3 max-h-64 overflow-y-auto bg-bg-secondary rounded p-2 space-y-1">
              {result.errors.slice(0, 50).map((e: any, i: number) => (
                <div key={i} className="text-caption">
                  <span className="text-text-tertiary">행 {e.row}</span> {e.error}
                </div>
              ))}
              {result.errors.length > 50 && (
                <div className="text-caption text-text-tertiary">... 외 {result.errors.length - 50}건</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
