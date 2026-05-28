"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User as UserIcon,
} from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface SupervisorInfo {
  supervisor: { id: number; name: string; topic_title: string | null } | null;
  semester_id: number | null;
}

interface ParsedMeta {
  year: number;
  grade: number;
  semester: number;
  report_type: string;
  fields: string[];
  title: string;
  is_excellent: boolean;
}

const DEFAULT_REPORT_TYPES = [
  "과학과제연구",
  "심층연구활동",
  "주제탐구",
  "융합과제연구",
  "졸업논문",
];

const DEFAULT_FIELDS = [
  "물리", "화학", "생명과학", "지구과학", "수학", "정보",
  "인공지능", "공학", "환경", "산업 및 에너지", "기타",
];

export default function ResearchSubmitPage() {
  const [supervisor, setSupervisor] = useState<SupervisorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<ParsedMeta>({
    year: new Date().getFullYear(),
    grade: 1,
    semester: 1,
    report_type: DEFAULT_REPORT_TYPES[0],
    fields: [],
    title: "",
    is_excellent: false,
  });
  const [parseSuccess, setParseSuccess] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/api/past-research/_my/supervisor")
      .then(setSupervisor)
      .catch(() => setSupervisor({ supervisor: null, semester_id: null }))
      .finally(() => setLoading(false));
  }, []);

  // 클라이언트 사이드 간이 파싱 (서버 파서와 동일 패턴)
  const parseFilename = (name: string): ParsedMeta | null => {
    const stem = name.replace(/\.pdf$/i, "");
    const re = /^(\d{4})\s+(\d)\s*학년\s+(\d)\s*학기\s+(.+?)\s+보고서\(\s*(.+?)\s*분야\s*\)_\s*(.+?)\s*$/;
    const m = stem.match(re);
    if (!m) return null;
    let title = m[6].trim();
    let is_excellent = false;
    const excTag = title.match(/\(\s*(우수|최우수|장려|입상)\s*\)\s*$/);
    if (excTag) {
      is_excellent = true;
      title = title.substring(0, excTag.index).trim();
    }
    return {
      year: parseInt(m[1]),
      grade: parseInt(m[2]),
      semester: parseInt(m[3]),
      report_type: m[4].trim(),
      fields: m[5].split(/[,·\/]/).map((f) => f.trim()).filter(Boolean),
      title,
      is_excellent,
    };
  };

  const onPickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      alert("PDF 파일만 가능합니다");
      return;
    }
    setFile(f);
    const parsed = parseFilename(f.name);
    if (parsed) {
      setMeta(parsed);
      setParseSuccess(true);
    } else {
      setParseSuccess(false);
    }
  };

  const standardFilename = () => {
    const fieldsStr = meta.fields.length ? meta.fields.join(", ") : "기타";
    const exc = meta.is_excellent ? "(우수)" : "";
    return `${meta.year} ${meta.grade}학년 ${meta.semester}학기 ${meta.report_type} 보고서(${fieldsStr} 분야)_${meta.title}${exc}.pdf`;
  };

  const toggleField = (f: string) => {
    setMeta((p) => ({
      ...p,
      fields: p.fields.includes(f) ? p.fields.filter((x) => x !== f) : [...p.fields, f],
    }));
  };

  const onSubmit = async () => {
    if (!file) { alert("파일을 선택하세요"); return; }
    if (!meta.title.trim()) { alert("제목을 입력하세요"); return; }
    if (meta.fields.length === 0) { alert("분야를 1개 이상 선택하세요"); return; }
    if (!supervisor?.supervisor) { alert("담당 교사가 지정되지 않았습니다"); return; }

    setSubmitting(true);
    setSubmitProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("meta", JSON.stringify(meta));
      const token = localStorage.getItem("access_token");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setSubmitProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              const d = JSON.parse(xhr.responseText);
              reject(new Error(d?.detail || `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("네트워크 오류"));
        xhr.open("POST", `${API_URL}/api/past-research/_submit`);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(fd);
      });

      alert("제출 완료! 담당 교사 승인을 기다려주세요.");
      setFile(null);
      setMeta({
        year: new Date().getFullYear(), grade: 1, semester: 1,
        report_type: DEFAULT_REPORT_TYPES[0], fields: [], title: "", is_excellent: false,
      });
      setParseSuccess(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e: any) {
      alert(`제출 실패: ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-title text-text-primary mb-1">연구 보고서 제출</h1>
      <p className="text-caption text-text-tertiary mb-4">
        본인 연구가 마무리되면 PDF를 업로드하고 메타정보를 입력해주세요. 담당 교사 승인 후 학생 산출물 갤러리에 등록됩니다.
      </p>

      {/* 담당 교사 표시 */}
      <div className="mb-4 p-3 bg-bg-primary border border-border-default rounded-lg flex items-center gap-3">
        <UserIcon size={18} className="text-accent" />
        <div className="flex-1">
          <div className="text-caption text-text-tertiary">담당 교사</div>
          {supervisor?.supervisor ? (
            <div className="text-body text-text-primary">
              {supervisor.supervisor.name} 선생님
              {supervisor.supervisor.topic_title && (
                <span className="ml-2 text-caption text-text-tertiary">/ {supervisor.supervisor.topic_title}</span>
              )}
            </div>
          ) : (
            <div className="text-body text-amber-700 flex items-center gap-1">
              <AlertCircle size={14} /> 미지정 — 담당 교사에게 등록을 요청하세요
            </div>
          )}
        </div>
      </div>

      {/* PDF 업로드 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onPickFile(e.dataTransfer.files[0]); }}
        className={`mb-3 border-2 border-dashed rounded-lg p-5 text-center transition ${
          dragOver ? "border-accent bg-cream-100" : "border-border-default bg-bg-primary"
        }`}
      >
        {file ? (
          <div>
            <FileText size={24} className="mx-auto text-accent mb-1" />
            <div className="text-body text-text-primary mb-1">{file.name}</div>
            <div className="text-caption text-text-tertiary mb-2">
              {(file.size / 1024 / 1024).toFixed(2)}MB
              {parseSuccess === true && <span className="ml-2 text-green-600">✓ 파일명에서 자동 추출 성공</span>}
              {parseSuccess === false && <span className="ml-2 text-amber-600">⚠ 파일명 패턴 불일치 — 아래에서 직접 입력</span>}
            </div>
            <button onClick={() => { setFile(null); setParseSuccess(null); }} className="text-caption text-accent hover:underline">
              다른 파일 선택
            </button>
          </div>
        ) : (
          <>
            <Upload size={28} className="mx-auto text-text-tertiary mb-2" />
            <p className="text-body text-text-primary mb-1">PDF를 여기로 드래그하거나 클릭하여 선택</p>
            <p className="text-caption text-text-tertiary mb-2">
              파일명이 표준 패턴이면 메타가 자동 입력됩니다
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => onPickFile(e.target.files?.[0])}
              className="hidden"
            />
            <button onClick={() => inputRef.current?.click()} className="px-4 py-1.5 bg-accent text-white rounded text-body">
              PDF 선택
            </button>
          </>
        )}
      </div>

      {/* 메타 폼 */}
      <div className="mb-4 p-4 bg-bg-primary border border-border-default rounded-lg">
        <h3 className="text-body font-semibold text-text-primary mb-3">보고서 메타정보</h3>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <label className="block">
            <span className="text-caption text-text-tertiary">연도</span>
            <input
              type="number" value={meta.year}
              onChange={(e) => setMeta((p) => ({ ...p, year: parseInt(e.target.value) || 0 }))}
              className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary"
            />
          </label>
          <label className="block">
            <span className="text-caption text-text-tertiary">학년</span>
            <select value={meta.grade} onChange={(e) => setMeta((p) => ({ ...p, grade: parseInt(e.target.value) }))}
                    className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
              <option value={1}>1학년</option>
              <option value={2}>2학년</option>
              <option value={3}>3학년</option>
            </select>
          </label>
          <label className="block">
            <span className="text-caption text-text-tertiary">학기</span>
            <select value={meta.semester} onChange={(e) => setMeta((p) => ({ ...p, semester: parseInt(e.target.value) }))}
                    className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
              <option value={1}>1학기</option>
              <option value={2}>2학기</option>
            </select>
          </label>
        </div>

        <label className="block mb-3">
          <span className="text-caption text-text-tertiary">보고서 종류</span>
          <input
            list="report_types" value={meta.report_type}
            onChange={(e) => setMeta((p) => ({ ...p, report_type: e.target.value }))}
            className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary"
          />
          <datalist id="report_types">
            {DEFAULT_REPORT_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>

        <div className="mb-3">
          <span className="text-caption text-text-tertiary">분야 (다중 선택)</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {Array.from(new Set([...DEFAULT_FIELDS, ...meta.fields])).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f)}
                className={`px-2 py-1 text-caption rounded border transition ${
                  meta.fields.includes(f)
                    ? "bg-accent text-white border-accent"
                    : "bg-bg-primary text-text-secondary border-border-default hover:border-accent"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <input
            type="text" placeholder="+ 새 분야 추가 후 Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = (e.target as HTMLInputElement).value.trim();
                if (v && !meta.fields.includes(v)) {
                  setMeta((p) => ({ ...p, fields: [...p.fields, v] }));
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
            className="mt-2 px-2 py-1 text-caption border border-border-default rounded bg-bg-primary w-full"
          />
        </div>

        <label className="block mb-3">
          <span className="text-caption text-text-tertiary">제목</span>
          <input
            type="text" value={meta.title}
            onChange={(e) => setMeta((p) => ({ ...p, title: e.target.value }))}
            placeholder="예: 다이오드의 특성 곡선과 실생활 응용에 관한 연구"
            className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary"
          />
        </label>

        <label className="flex items-center gap-2 mb-3">
          <input
            type="checkbox" checked={meta.is_excellent}
            onChange={(e) => setMeta((p) => ({ ...p, is_excellent: e.target.checked }))}
          />
          <span className="text-caption text-text-secondary">우수상 수상 작품</span>
        </label>

        <div className="p-2 bg-bg-secondary rounded text-caption text-text-tertiary">
          <span className="text-text-tertiary mr-1">저장 파일명 미리보기:</span>
          <span className="font-mono text-text-primary">{standardFilename()}</span>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={submitting || !file || !meta.title || meta.fields.length === 0 || !supervisor?.supervisor}
        className="w-full px-4 py-2.5 bg-accent text-white rounded text-body font-medium disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting ? <><Loader2 size={16} className="animate-spin" /> 제출 중... {submitProgress}%</> : <><CheckCircle2 size={16} /> 담당 교사에게 제출</>}
      </button>
    </div>
  );
}
