"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Search,
  FileText,
  Trash2,
  Download,
  Award,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Filter,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure, fetchPdfBlobUrl } from "@/lib/api/download";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface Item {
  id: number;
  year: number;
  grade: number | null;
  semester: number | null;
  report_type: string | null;
  fields: string[];
  title: string;
  is_excellent: boolean;
  original_filename: string;
  file_size: number;
  file_url: string;
  created_at: string | null;
}

interface Facets {
  years: number[];
  report_types: string[];
  grades: number[];
  fields: string[];
}

interface UploadResult {
  success: number;
  skipped: { filename: string; reason: string }[];
  failed: { filename: string; reason: string }[];
}

export default function PastResearchAdminPage() {
  const { isAdmin } = useAuth();  // super_admin | designated_admin — ZIP 업로드/삭제는 이들만
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // PDF 미리보기 (브라우저 내장 뷰어 — 서버 렌더링 X, 부담 없음)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);

  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [grade, setGrade] = useState("");
  const [reportType, setReportType] = useState("");
  const [field, setField] = useState("");

  const [facets, setFacets] = useState<Facets>({ years: [], report_types: [], grades: [], fields: [] });

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pageSize = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (keyword) params.set("keyword", keyword);
      if (year) params.set("year", year);
      if (semester) params.set("semester", semester);
      if (grade) params.set("grade", grade);
      if (reportType) params.set("report_type", reportType);
      if (field) params.set("field", field);
      const data = await api.get(`/api/past-research?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, year, semester, grade, reportType, field]);

  const loadFacets = useCallback(async () => {
    try {
      const data = await api.get("/api/past-research/_facets");
      setFacets(data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadFacets(); }, [loadFacets]);

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setKeyword(searchInput);
  };

  const onPickFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      alert("ZIP 파일만 업로드 가능합니다.");
      return;
    }
    uploadZip(file);
  };

  const uploadZip = async (file: File) => {
    setUploading(true);
    setUploadResult(null);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("access_token");

      const result = await new Promise<UploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(new Error("응답 파싱 실패"));
            }
          } else {
            try {
              const d = JSON.parse(xhr.responseText);
              reject(new Error(d?.detail || `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("네트워크 오류"));
        xhr.open("POST", `${API_URL}/api/past-research/_bulk-upload`);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(formData);
      });

      setUploadResult(result);
      await load();
      await loadFacets();
    } catch (err: any) {
      alert(`업로드 실패: ${err.message || err}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDelete = async (id: number, title: string) => {
    if (!confirm(`정말 삭제하시겠습니까?\n\n${title}`)) return;
    try {
      await api.delete(`/api/past-research/${id}`);
      await load();
      await loadFacets();
    } catch (err: any) {
      alert(`삭제 실패: ${err?.detail || err}`);
    }
  };

  const openPreview = async (it: Item) => {
    setPreviewLoadingId(it.id);
    const url = await fetchPdfBlobUrl(`/api/past-research/${it.id}/file`);
    setPreviewLoadingId(null);
    if (url) { setPreviewTitle(it.title); setPreviewUrl(url); }
  };
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewTitle("");
  };

  const totalPages = Math.ceil(total / pageSize);
  const fmtSize = (n: number) =>
    n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;

  const resetFilters = () => {
    setSearchInput(""); setKeyword("");
    setYear(""); setSemester(""); setGrade(""); setReportType(""); setField("");
    setPage(1);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">과거 연구 보고서 아카이브</h1>
          <p className="text-caption text-text-tertiary mt-1">
            {isAdmin
              ? "ZIP 파일로 한 번에 등록 · 파일명 자동 파싱 · 학생/교사 검색 제공"
              : "선배들의 연구 보고서 — 검색 · 미리보기 · 다운로드"}
          </p>
        </div>
      </div>

      {/* 업로드 영역 — 최고관리자/지정관리자만 */}
      {isAdmin && (<>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onPickFile(e.dataTransfer.files[0]);
        }}
        className={`mb-4 border-2 border-dashed rounded-lg p-6 text-center transition ${
          dragOver ? "border-accent bg-cream-100" : "border-border-default bg-bg-primary"
        }`}
      >
        <Upload size={32} className="mx-auto text-text-tertiary mb-2" />
        <p className="text-body text-text-primary mb-1">
          ZIP 파일을 여기로 드래그하거나 클릭하여 선택
        </p>
        <p className="text-caption text-text-tertiary mb-3">
          파일명 패턴: <code className="px-1 bg-bg-secondary rounded text-[11px]">YYYY N학년 S학기 보고서종류 보고서(분야)_제목.pdf</code>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          onChange={(e) => onPickFile(e.target.files?.[0])}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50 inline-flex items-center gap-2"
        >
          {uploading ? <><Loader2 size={16} className="animate-spin" /> 업로드 중...</> : <><Upload size={16} /> ZIP 선택</>}
        </button>

        {uploading && (
          <div className="mt-3 max-w-md mx-auto">
            <div className="h-2 bg-bg-secondary rounded overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
            <div className="text-caption text-text-tertiary mt-1">{uploadProgress}%</div>
          </div>
        )}
      </div>

      {/* 업로드 결과 */}
      {uploadResult && (
        <div className="mb-4 bg-bg-primary border border-border-default rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={18} className="text-green-600" />
            <span className="text-body font-semibold text-text-primary">업로드 완료</span>
            <button onClick={() => setUploadResult(null)} className="ml-auto text-caption text-text-tertiary hover:text-text-primary">
              닫기
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Stat label="등록됨" count={uploadResult.success} color="green" />
            <Stat label="중복 skip" count={uploadResult.skipped.length} color="yellow" />
            <Stat label="실패" count={uploadResult.failed.length} color="red" />
          </div>
          {uploadResult.failed.length > 0 && (
            <details className="text-caption">
              <summary className="cursor-pointer text-red-600 font-medium">실패 파일 보기 ({uploadResult.failed.length})</summary>
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                {uploadResult.failed.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-red-50 rounded">
                    <XCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-text-primary">{f.filename}</div>
                      <div className="text-red-700">{f.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {uploadResult.skipped.length > 0 && (
            <details className="text-caption mt-2">
              <summary className="cursor-pointer text-yellow-700 font-medium">중복 skip ({uploadResult.skipped.length})</summary>
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                {uploadResult.skipped.map((f, i) => (
                  <div key={i} className="p-2 bg-yellow-50 rounded text-text-primary">{f.filename}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      </>)}

      {/* 검색·필터 */}
      <form onSubmit={onSubmitSearch} className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex flex-1 min-w-[240px]">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="제목 검색"
            className="flex-1 px-3 py-1.5 border border-border-default rounded-l text-body bg-bg-primary"
          />
          <button type="submit" className="px-3 py-1.5 bg-accent text-white rounded-r">
            <Search size={14} />
          </button>
        </div>
        <select value={year} onChange={(e) => { setPage(1); setYear(e.target.value); }} className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary">
          <option value="">전체 연도</option>
          {facets.years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={semester} onChange={(e) => { setPage(1); setSemester(e.target.value); }} className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary">
          <option value="">전체 학기</option>
          <option value="1">1학기</option>
          <option value="2">2학기</option>
        </select>
        <select value={grade} onChange={(e) => { setPage(1); setGrade(e.target.value); }} className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary">
          <option value="">전체 학년</option>
          {facets.grades.map((g) => <option key={g} value={g}>{g}학년</option>)}
        </select>
        <select value={reportType} onChange={(e) => { setPage(1); setReportType(e.target.value); }} className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary">
          <option value="">전체 보고서</option>
          {facets.report_types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={field} onChange={(e) => { setPage(1); setField(e.target.value); }} className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary">
          <option value="">전체 분야</option>
          {facets.fields.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button type="button" onClick={resetFilters} className="text-caption text-text-tertiary hover:text-text-primary">
          초기화
        </button>
        <span className="ml-auto text-caption text-text-tertiary">총 {total}건</span>
      </form>

      {/* List */}
      <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary">
            <Loader2 size={20} className="animate-spin mx-auto" />
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-text-tertiary">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            <div className="text-body">조회된 보고서가 없습니다</div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-bg-secondary border-b border-border-default">
              <tr className="text-caption text-text-tertiary">
                <th className="text-left px-3 py-2 font-medium">연도/학기</th>
                <th className="text-left px-3 py-2 font-medium">보고서</th>
                <th className="text-left px-3 py-2 font-medium">분야</th>
                <th className="text-left px-3 py-2 font-medium">제목</th>
                <th className="text-right px-3 py-2 font-medium w-32">크기</th>
                <th className="text-right px-3 py-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} onClick={() => openPreview(it)} title="클릭하여 미리보기"
                    className="border-b border-border-default last:border-b-0 hover:bg-bg-secondary cursor-pointer">
                  <td className="px-3 py-2 text-caption text-text-secondary whitespace-nowrap">
                    {it.year}년 {it.grade ? `${it.grade}학년` : ""} {it.semester ? `${it.semester}학기` : ""}
                  </td>
                  <td className="px-3 py-2 text-caption text-text-secondary whitespace-nowrap">
                    {it.report_type || "-"}
                  </td>
                  <td className="px-3 py-2 text-caption">
                    <div className="flex flex-wrap gap-1">
                      {it.fields.map((f) => (
                        <span key={f} className="px-1.5 py-0.5 bg-cream-100 text-blue-700 rounded text-[10px]">
                          {f}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-body text-text-primary">
                    <div className="flex items-center gap-1">
                      <span>{it.title}</span>
                      {it.is_excellent && (
                        <span title="우수상" className="inline-flex items-center text-amber-600">
                          <Award size={12} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-caption text-text-tertiary">
                    {fmtSize(it.file_size)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {previewLoadingId === it.id && (
                      <Loader2 size={14} className="animate-spin inline-block mr-1 text-text-tertiary align-middle" />
                    )}
                    <button
                      onClick={() => downloadSecure(`/api/past-research/${it.id}/file`, it.original_filename)}
                      title="다운로드"
                      className="p-1.5 hover:bg-bg-primary rounded text-text-secondary"
                    >
                      <Download size={14} />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => onDelete(it.id, it.title)}
                        title="삭제"
                        className="p-1.5 hover:bg-red-50 rounded text-red-600 ml-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1 rounded border border-border-default text-caption disabled:opacity-40">
            이전
          </button>
          <span className="text-caption text-text-secondary">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1 rounded border border-border-default text-caption disabled:opacity-40">
            다음
          </button>
        </div>
      )}

      {/* PDF 미리보기 모달 — 브라우저 내장 뷰어(iframe). 서버 렌더링 X */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closePreview}>
          <div className="bg-bg-primary rounded-lg w-full max-w-4xl h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
              <span className="text-body font-medium text-text-primary truncate pr-2">{previewTitle}</span>
              <button onClick={closePreview} title="닫기" className="text-text-tertiary hover:text-text-primary flex-shrink-0">
                <X size={18} />
              </button>
            </div>
            <iframe src={previewUrl} title={previewTitle} className="flex-1 w-full rounded-b-lg" />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, count, color }: { label: string; count: number; color: "green" | "yellow" | "red" }) {
  const c = {
    green: "bg-green-50 text-green-700 border-green-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    red: "bg-red-50 text-red-700 border-red-200",
  }[color];
  return (
    <div className={`border rounded p-2 text-center ${c}`}>
      <div className="text-title font-semibold">{count}</div>
      <div className="text-caption">{label}</div>
    </div>
  );
}
