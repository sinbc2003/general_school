"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Upload,
  FileText,
  Download,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

interface DocumentItem {
  id: number;
  title: string;
  doc_type: string;
  subject: string;
  grade: number | null;
  year: number | null;
  file_size: number;
  status: string;
  created_at: string;
}

interface DocumentListResponse {
  items: DocumentItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  exam: "시험지",
  worksheet: "학습지",
  reference: "참고자료",
  textbook: "교과서",
  guide: "교사용 지도서",
  other: "기타",
};

const SUBJECT_OPTIONS = [
  "수학", "국어", "영어", "과학", "사회", "역사", "도덕",
  "물리", "화학", "생물", "지구과학", "기타",
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // 업로드 폼 상태
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDocType, setUploadDocType] = useState("exam");
  const [uploadSubject, setUploadSubject] = useState("수학");
  const [uploadGrade, setUploadGrade] = useState("");
  const [uploadYear, setUploadYear] = useState(String(new Date().getFullYear()));
  const [uploading, setUploading] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (docTypeFilter) params.set("doc_type", docTypeFilter);
      if (subjectFilter) params.set("subject", subjectFilter);
      const data = await api.get<DocumentListResponse>(`/api/archive/documents?${params}`);
      setDocuments(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "문서 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, docTypeFilter, subjectFilter]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleUpload = async () => {
    if (!uploadFile) {
      alert("파일을 선택해주세요.");
      return;
    }
    if (!uploadTitle.trim()) {
      alert("제목을 입력해주세요.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("title", uploadTitle.trim());
      formData.append("doc_type", uploadDocType);
      formData.append("subject", uploadSubject);
      if (uploadGrade) formData.append("grade", uploadGrade);
      if (uploadYear) formData.append("year", uploadYear);

      await api.post("/api/archive/documents/upload", formData);
      alert("업로드 완료");
      setShowUpload(false);
      resetUploadForm();
      fetchDocuments();
    } catch (err: any) {
      alert(err?.detail || "업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadTitle("");
    setUploadDocType("exam");
    setUploadSubject("수학");
    setUploadGrade("");
    setUploadYear(String(new Date().getFullYear()));
  };

  const handleDelete = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/archive/documents/${id}`);
      fetchDocuments();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const handleDownload = (id: number) => {
    const token = localStorage.getItem("access_token");
    const url = `${API_URL}/api/archive/documents/${id}/download`;
    const a = document.createElement("a");
    a.href = `${url}?token=${token}`;
    a.target = "_blank";
    a.click();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">문서 관리</h1>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Upload size={14} />
          문서 업로드
        </button>
      </div>

      {/* 업로드 폼 */}
      {showUpload && (
        <div className="mb-6 p-4 bg-bg-primary rounded-lg border border-border-default">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-body font-medium text-text-primary">문서 업로드</h2>
            <button onClick={() => { setShowUpload(false); resetUploadForm(); }} className="text-text-tertiary hover:text-text-primary">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-caption text-text-secondary mb-1">제목</label>
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="문서 제목"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">문서 유형</label>
              <select
                value={uploadDocType}
                onChange={(e) => setUploadDocType(e.target.value)}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              >
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">과목</label>
              <select
                value={uploadSubject}
                onChange={(e) => setUploadSubject(e.target.value)}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              >
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">학년</label>
              <select
                value={uploadGrade}
                onChange={(e) => setUploadGrade(e.target.value)}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              >
                <option value="">선택안함</option>
                <option value="1">1학년</option>
                <option value="2">2학년</option>
                <option value="3">3학년</option>
              </select>
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">연도</label>
              <input
                type="number"
                value={uploadYear}
                onChange={(e) => setUploadYear(e.target.value)}
                placeholder="2024"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-caption text-text-secondary mb-1">파일</label>
              <input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="w-full text-body text-text-secondary file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-caption file:bg-accent file:text-white file:cursor-pointer"
              />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
            >
              {uploading ? "업로드 중..." : "업로드"}
            </button>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={docTypeFilter}
          onChange={(e) => { setDocTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체 유형</option>
          {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={subjectFilter}
          onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체 과목</option>
          {SUBJECT_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-caption text-text-tertiary ml-auto">
          총 {total}건
        </span>
      </div>

      {/* 테이블 */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">제목</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">유형</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">과목</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학년</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">연도</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">크기</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">등록일</th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-t border-border-default hover:bg-bg-secondary">
                <td className="px-4 py-2 text-body text-text-primary">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-text-tertiary flex-shrink-0" />
                    {doc.title}
                  </div>
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">{doc.subject}</td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {doc.grade ? `${doc.grade}학년` : "-"}
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">{doc.year || "-"}</td>
                <td className="px-4 py-2 text-caption text-text-tertiary">{formatFileSize(doc.file_size)}</td>
                <td className="px-4 py-2 text-caption text-text-tertiary">{formatDate(doc.created_at)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => handleDownload(doc.id)}
                      title="다운로드"
                      className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      title="삭제"
                      className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : "문서가 없습니다"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages} ({total}건)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
