"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  ExternalLink,
  Clock,
} from "lucide-react";

interface Paper {
  id: number;
  title: string;
  authors: string;
  published_date: string;
  arxiv_id: string | null;
  status: string;
  is_visible: boolean;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function FeedPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const pageSize = 20;

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get(`/api/papers?${params}`);
      setPapers(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  const handleStatusChange = async (paperId: number, status: string) => {
    try {
      await api.put(`/api/papers/${paperId}/status`, { status });
      fetchPapers();
    } catch (err: any) {
      alert(err?.detail || "상태 변경 실패");
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">수집 논문</h1>
        <div className="flex items-center gap-2">
          <span className="text-caption text-text-tertiary">
            총 {total}편
          </span>
        </div>
      </div>

      {/* 상태 필터 */}
      <div className="flex items-center gap-2 mb-4">
        {[
          { value: "", label: "전체" },
          { value: "pending", label: "대기" },
          { value: "approved", label: "승인" },
          { value: "rejected", label: "반려" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setStatusFilter(opt.value);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-caption rounded border ${
              statusFilter === opt.value
                ? "bg-accent text-white border-accent"
                : "bg-bg-primary text-text-secondary border-border-default hover:bg-bg-secondary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 논문 테이블 */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">
                제목
              </th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">
                저자
              </th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">
                발행일
              </th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium">
                상태
              </th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium">
                작업
              </th>
            </tr>
          </thead>
          <tbody>
            {papers.map((paper) => (
              <tr
                key={paper.id}
                className="border-t border-border-default hover:bg-bg-secondary"
              >
                <td className="px-4 py-2 text-body text-text-primary max-w-md">
                  <div className="flex items-center gap-1">
                    <span className="line-clamp-2">{paper.title}</span>
                    {paper.arxiv_id && (
                      <a
                        href={`https://arxiv.org/abs/${paper.arxiv_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-accent hover:opacity-70"
                        title="arXiv에서 보기"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-caption text-text-secondary max-w-[200px] truncate">
                  {paper.authors}
                </td>
                <td className="px-4 py-2 text-caption text-text-secondary whitespace-nowrap">
                  {paper.published_date}
                </td>
                <td className="px-4 py-2 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 text-caption rounded ${
                      STATUS_STYLES[paper.status] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {STATUS_LABELS[paper.status] || paper.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    {paper.status !== "approved" && (
                      <button
                        onClick={() =>
                          handleStatusChange(paper.id, "approved")
                        }
                        className="p-1 rounded hover:bg-green-50 text-status-success"
                        title="승인"
                      >
                        <Check size={16} />
                      </button>
                    )}
                    {paper.status !== "rejected" && (
                      <button
                        onClick={() =>
                          handleStatusChange(paper.id, "rejected")
                        }
                        className="p-1 rounded hover:bg-red-50 text-status-error"
                        title="반려"
                      >
                        <X size={16} />
                      </button>
                    )}
                    {paper.status !== "pending" && (
                      <button
                        onClick={() =>
                          handleStatusChange(paper.id, "pending")
                        }
                        className="p-1 rounded hover:bg-yellow-50 text-status-warning"
                        title="대기로 되돌리기"
                      >
                        <Clock size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {papers.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-body text-text-tertiary"
                >
                  {loading ? "로딩 중..." : "논문이 없습니다"}
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
            {page} / {totalPages} ({total}편)
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
