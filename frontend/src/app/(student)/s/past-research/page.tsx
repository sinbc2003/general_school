"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, FileText, Download, Award, Loader2, Eye, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure, fetchPdfBlobUrl } from "@/lib/api/download";

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
}

interface Facets {
  years: number[];
  report_types: string[];
  grades: number[];
  fields: string[];
}

export default function PastResearchStudentPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

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
    } catch {
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

  const openPreview = async (it: Item) => {
    setPreviewLoadingId(it.id);
    const url = await fetchPdfBlobUrl(it.file_url);
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

  return (
    <div>
      <h1 className="text-title text-text-primary mb-1">선배 연구 보고서</h1>
      <p className="text-caption text-text-tertiary mb-4">
        선배들의 완료된 연구 보고서를 열람하여 진로 탐색·연구 주제 참고에 활용하세요.
      </p>

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
        <select value={field} onChange={(e) => { setPage(1); setField(e.target.value); }} className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary">
          <option value="">전체 분야</option>
          {facets.fields.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={reportType} onChange={(e) => { setPage(1); setReportType(e.target.value); }} className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary">
          <option value="">전체 보고서</option>
          {facets.report_types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="ml-auto text-caption text-text-tertiary">총 {total}건</span>
      </form>

      {/* 카드 그리드 */}
      {loading ? (
        <div className="p-12 text-center text-text-tertiary">
          <Loader2 size={20} className="animate-spin mx-auto" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-text-tertiary bg-bg-primary border border-border-default rounded-lg">
          <FileText size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-body">조회된 보고서가 없습니다</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((it) => (
            <div key={it.id} className="bg-bg-primary border border-border-default rounded-lg p-3 hover:border-accent transition">
              <div className="flex items-center gap-1 mb-2 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 bg-bg-secondary text-text-secondary rounded">
                  {it.year}년
                </span>
                {it.semester && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-secondary text-text-secondary rounded">
                    {it.semester}학기
                  </span>
                )}
                {it.grade && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-secondary text-text-secondary rounded">
                    {it.grade}학년
                  </span>
                )}
                {it.is_excellent && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded inline-flex items-center gap-1">
                    <Award size={10} /> 우수
                  </span>
                )}
              </div>
              <div className="text-body font-medium text-text-primary mb-2 line-clamp-3">
                {it.title}
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {it.fields.map((f) => (
                  <span key={f} className="text-[10px] px-1.5 py-0.5 bg-cream-100 text-blue-700 rounded">
                    {f}
                  </span>
                ))}
                {it.report_type && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-secondary text-text-tertiary rounded">
                    {it.report_type}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-caption">
                <span className="text-text-tertiary">{fmtSize(it.file_size)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openPreview(it)}
                    disabled={previewLoadingId === it.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
                  >
                    {previewLoadingId === it.id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} 미리보기
                  </button>
                  <button
                    onClick={() => downloadSecure(it.file_url, it.original_filename)}
                    title="다운로드"
                    className="p-1.5 border border-border-default rounded text-text-secondary hover:bg-bg-secondary"
                  >
                    <Download size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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

      <div className="mt-6 text-caption text-text-tertiary text-center">
        ※ 진로 탐색·연구 주제 참고용으로 제공됩니다. 무단 복제·표절은 금지됩니다.
      </div>

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
