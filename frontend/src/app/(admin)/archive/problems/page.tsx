"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit3,
  X,
} from "lucide-react";

interface ProblemItem {
  id: number;
  subject: string;
  difficulty: string;
  question_type: string;
  year: number | null;
  content: string;
  tags: string[];
  review_status: string;
  created_at: string;
}

interface ProblemListResponse {
  items: ProblemItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "하",
  medium: "중",
  hard: "상",
  very_hard: "최상",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  hard: "bg-orange-100 text-orange-700",
  very_hard: "bg-red-100 text-red-700",
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "단답형",
  essay: "서술형",
  proof: "증명",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "검토 대기",
  approved: "승인",
  rejected: "반려",
};

const SUBJECT_OPTIONS = [
  "수학", "국어", "영어", "과학", "사회", "역사", "도덕",
  "물리", "화학", "생물", "지구과학", "기타",
];

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

interface ProblemFormData {
  subject: string;
  difficulty: string;
  question_type: string;
  content: string;
  solution: string;
  answer: string;
  grade_semester: string;
  year: string;
  tags: string;
}

const EMPTY_FORM: ProblemFormData = {
  subject: "수학",
  difficulty: "medium",
  question_type: "multiple_choice",
  content: "",
  solution: "",
  answer: "",
  grade_semester: "",
  year: String(new Date().getFullYear()),
  tags: "",
};

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
  const [form, setForm] = useState<ProblemFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

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

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (problem: ProblemItem) => {
    setEditingId(problem.id);
    setForm({
      subject: problem.subject,
      difficulty: problem.difficulty,
      question_type: problem.question_type,
      content: problem.content,
      solution: "",
      answer: "",
      grade_semester: "",
      year: problem.year ? String(problem.year) : "",
      tags: problem.tags?.join(", ") || "",
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.content.trim()) {
      alert("문제 내용을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        subject: form.subject,
        difficulty: form.difficulty,
        question_type: form.question_type,
        content: form.content.trim(),
        solution: form.solution.trim() || null,
        answer: form.answer.trim() || null,
        grade_semester: form.grade_semester.trim() || null,
        year: form.year ? Number(form.year) : null,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      };

      if (editingId) {
        await api.put(`/api/archive/problems/${editingId}`, body);
        alert("수정 완료");
      } else {
        await api.post("/api/archive/problems", body);
        alert("등록 완료");
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      fetchProblems();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/archive/problems/${id}`);
      fetchProblems();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const updateForm = (key: keyof ProblemFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">문제 DB</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Plus size={14} />
          문제 등록
        </button>
      </div>

      {/* 등록/수정 폼 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-body font-medium text-text-primary">
                {editingId ? "문제 수정" : "문제 등록"}
              </h2>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-text-tertiary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-caption text-text-secondary mb-1">과목</label>
                <select
                  value={form.subject}
                  onChange={(e) => updateForm("subject", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  {SUBJECT_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">난이도</label>
                <select
                  value={form.difficulty}
                  onChange={(e) => updateForm("difficulty", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">문제 유형</label>
                <select
                  value={form.question_type}
                  onChange={(e) => updateForm("question_type", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">학년/학기</label>
                <input
                  type="text"
                  value={form.grade_semester}
                  onChange={(e) => updateForm("grade_semester", e.target.value)}
                  placeholder="예: 1-1, 2-2"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">연도</label>
                <input
                  type="number"
                  value={form.year}
                  onChange={(e) => updateForm("year", e.target.value)}
                  placeholder="2024"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">태그 (쉼표 구분)</label>
                <input
                  type="text"
                  value={form.tags}
                  onChange={(e) => updateForm("tags", e.target.value)}
                  placeholder="미적분, 함수, 극한"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">문제 내용 *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => updateForm("content", e.target.value)}
                  rows={5}
                  placeholder="문제 내용을 입력하세요"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">풀이</label>
                <textarea
                  value={form.solution}
                  onChange={(e) => updateForm("solution", e.target.value)}
                  rows={4}
                  placeholder="풀이 과정을 입력하세요"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">정답</label>
                <input
                  type="text"
                  value={form.answer}
                  onChange={(e) => updateForm("answer", e.target.value)}
                  placeholder="정답"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
              >
                {submitting ? "저장 중..." : editingId ? "수정" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                      onClick={() => openEdit(p)}
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
