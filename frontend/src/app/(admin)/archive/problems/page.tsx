"use client";

/**
 * 문제 DB 관리 페이지.
 *
 * 필터·페이지네이션·테이블만 본 파일. 등록/수정 모달은 _components/ProblemFormModal.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import {
  ChevronLeft, ChevronRight, Edit3, Plus, Search, Trash2,
} from "lucide-react";

import type { ProblemItem, ProblemListResponse } from "./_shared";
import {
  DIFFICULTY_COLORS, DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS, REVIEW_STATUS_LABELS, SUBJECT_OPTIONS,
  formatDate,
} from "./_shared";
import { ProblemFormModal } from "./_components/ProblemFormModal";

export default function ProblemsPage() {
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // 모달 상태
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchProblems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (subjectFilter) params.set("subject", subjectFilter);
      if (difficultyFilter) params.set("difficulty", difficultyFilter);
      if (typeFilter) params.set("question_type", typeFilter);
      if (searchQuery) params.set("search", searchQuery);
      const data = await api.get<ProblemListResponse>(`/api/archive/problems?${params}`);
      setProblems(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "문제 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, subjectFilter, difficultyFilter, typeFilter, searchQuery]);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  const editingProblem = editingId ? problems.find((p) => p.id === editingId) ?? null : null;

  const handleDelete = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/archive/problems/${id}`);
      fetchProblems();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">문제 DB</h1>
        <button
          onClick={() => {
            setEditingId(null);
            setShowForm(true);
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Plus size={14} />
          문제 등록
        </button>
      </div>

      <ProblemFormModal
        open={showForm}
        editingId={editingId}
        editingProblem={editingProblem}
        onClose={() => {
          setShowForm(false);
          setEditingId(null);
        }}
        onSaved={fetchProblems}
      />

      {/* 필터 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={16} className="text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="문제 내용 검색"
            className="flex-1 px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
          />
        </div>
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
        <select
          value={difficultyFilter}
          onChange={(e) => { setDifficultyFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체 난이도</option>
          {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체 유형</option>
          {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* 테이블 */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium w-[80px]">ID</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">내용 미리보기</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">과목</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">난이도</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">유형</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">태그</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">상태</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">등록일</th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((p) => (
              <tr key={p.id} className="border-t border-border-default hover:bg-bg-secondary">
                <td className="px-4 py-2 text-caption text-text-tertiary">{p.id}</td>
                <td className="px-4 py-2 text-body text-text-primary max-w-[300px]">
                  <div className="truncate" title={p.content}>
                    {p.content}
                  </div>
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">{p.subject}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block px-2 py-0.5 text-caption rounded ${DIFFICULTY_COLORS[p.difficulty] || "bg-gray-100 text-gray-700"}`}>
                    {DIFFICULTY_LABELS[p.difficulty] || p.difficulty}
                  </span>
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {QUESTION_TYPE_LABELS[p.question_type] || p.question_type}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {p.tags?.slice(0, 3).map((tag, i) => (
                      <span key={i} className="inline-block px-1.5 py-0.5 text-caption bg-bg-secondary text-text-secondary rounded">
                        {tag}
                      </span>
                    ))}
                    {p.tags?.length > 3 && (
                      <span className="text-caption text-text-tertiary">+{p.tags.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-caption ${
                    p.review_status === "approved" ? "text-status-success" :
                    p.review_status === "rejected" ? "text-status-error" :
                    "text-status-warning"
                  }`}>
                    {REVIEW_STATUS_LABELS[p.review_status] || p.review_status}
                  </span>
                </td>
                <td className="px-4 py-2 text-caption text-text-tertiary">{formatDate(p.created_at)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(p.id);
                        setShowForm(true);
                      }}
                      title="수정"
                      className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      title="삭제"
                      className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {problems.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : "문제가 없습니다"}
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
