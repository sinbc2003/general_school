"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Users,
  Plus,
  ArrowLeft,
  ThumbsUp,
  Star,
  Send,
  X,
} from "lucide-react";

interface CommunityProblem {
  id: number;
  title: string;
  subject?: string;
  difficulty?: number;
  status?: string;
  solve_count?: number;
  vote_count?: number;
  avg_rating?: number;
}

interface ProblemDetail {
  id: number;
  title: string;
  content: string;
  solution?: string;
  answer?: string;
  subject?: string;
  difficulty?: number;
  question_type?: string;
  solve_count?: number;
  vote_count?: number;
  avg_rating?: number;
}

interface Solution {
  id: number;
  content: string;
  user_name?: string;
  created_at?: string;
}

type ViewMode = "list" | "detail" | "create";

const SUBJECTS = ["수학", "물리", "화학", "생명과학", "지구과학", "정보"];

export default function CommunityPage() {
  const [problems, setProblems] = useState<CommunityProblem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Detail state
  const [detail, setDetail] = useState<ProblemDetail | null>(null);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [newSolution, setNewSolution] = useState("");
  const [myRating, setMyRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Create form state
  const [form, setForm] = useState({
    title: "",
    content: "",
    solution: "",
    answer: "",
    subject: "수학",
    difficulty: 3,
    question_type: "short_answer",
  });

  const pageSize = 10;

  const fetchProblems = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/community/problems?page=${page}&page_size=${pageSize}`;
      if (subject) url += `&subject=${encodeURIComponent(subject)}`;
      const data = await api.get(url);
      setProblems(data.items || []);
      setTotal(data.total || 0);
    } catch {
      setProblems([]);
    } finally {
      setLoading(false);
    }
  }, [page, subject]);

  useEffect(() => {
    if (viewMode === "list") fetchProblems();
  }, [fetchProblems, viewMode]);

  const openDetail = async (id: number) => {
    try {
      const [detailData, solutionsData] = await Promise.all([
        api.get(`/api/community/problems/${id}`),
        api.get(`/api/community/problems/${id}/solutions`),
      ]);
      setDetail(detailData);
      setSolutions(solutionsData?.items || solutionsData || []);
      setViewMode("detail");
    } catch {
      alert("문제를 불러올 수 없습니다.");
    }
  };

  const submitSolution = async () => {
    if (!detail || !newSolution.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/community/problems/${detail.id}/solutions`, {
        content: newSolution,
      });
      const solutionsData = await api.get(
        `/api/community/problems/${detail.id}/solutions`
      );
      setSolutions(solutionsData?.items || solutionsData || []);
      setNewSolution("");
    } catch {
      alert("풀이 제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitVote = async (rating: number) => {
    if (!detail) return;
    try {
      await api.post(`/api/community/problems/${detail.id}/vote`, { rating });
      setMyRating(rating);
    } catch {
      alert("평가에 실패했습니다.");
    }
  };

  const createProblem = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      alert("제목과 내용을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/community/problems", form);
      setForm({
        title: "",
        content: "",
        solution: "",
        answer: "",
        subject: "수학",
        difficulty: 3,
        question_type: "short_answer",
      });
      setViewMode("list");
    } catch {
      alert("문제 생성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Create view
  if (viewMode === "create") {
    return (
      <div>
        <button
          onClick={() => setViewMode("list")}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <h1 className="text-title text-text-primary mb-4">문제 출제</h1>

        <div className="space-y-4">
          <div>
            <label className="text-caption text-text-secondary block mb-1">
              제목
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary"
              placeholder="문제 제목"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-caption text-text-secondary block mb-1">
                과목
              </label>
              <select
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary"
              >
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-caption text-text-secondary block mb-1">
                난이도
              </label>
              <select
                value={form.difficulty}
                onChange={(e) =>
                  setForm({ ...form, difficulty: Number(e.target.value) })
                }
                className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary"
              >
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-caption text-text-secondary block mb-1">
              유형
            </label>
            <select
              value={form.question_type}
              onChange={(e) =>
                setForm({ ...form, question_type: e.target.value })
              }
              className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary"
            >
              <option value="short_answer">주관식</option>
              <option value="multiple_choice">객관식</option>
              <option value="essay">서술형</option>
            </select>
          </div>

          <div>
            <label className="text-caption text-text-secondary block mb-1">
              문제 내용
            </label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={6}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary resize-none"
              placeholder="문제 내용을 작성하세요."
            />
          </div>

          <div>
            <label className="text-caption text-text-secondary block mb-1">
              정답
            </label>
            <input
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary"
              placeholder="정답"
            />
          </div>

          <div>
            <label className="text-caption text-text-secondary block mb-1">
              풀이 (선택)
            </label>
            <textarea
              value={form.solution}
              onChange={(e) => setForm({ ...form, solution: e.target.value })}
              rows={4}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary resize-none"
              placeholder="풀이 과정 (선택사항)"
            />
          </div>

          <button
            onClick={createProblem}
            disabled={submitting}
            className="w-full py-3 bg-accent text-white rounded-lg text-body font-medium disabled:opacity-50"
          >
            {submitting ? "생성 중..." : "문제 등록"}
          </button>
        </div>
      </div>
    );
  }

  // Detail view
  if (viewMode === "detail" && detail) {
    return (
      <div>
        <button
          onClick={() => {
            setViewMode("list");
            setDetail(null);
            setSolutions([]);
            setMyRating(0);
          }}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            {detail.subject && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                {detail.subject}
              </span>
            )}
            {detail.difficulty && (
              <span className="text-[11px] text-yellow-500">
                {"★".repeat(detail.difficulty)}{"☆".repeat(5 - detail.difficulty)}
              </span>
            )}
          </div>
          <h1 className="text-title text-text-primary mb-3">{detail.title}</h1>
          <p className="text-body text-text-primary whitespace-pre-wrap">
            {detail.content}
          </p>

          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border-default">
            <span className="text-caption text-text-tertiary">
              풀이 {detail.solve_count || 0}
            </span>
            <span className="text-caption text-text-tertiary">
              투표 {detail.vote_count || 0}
            </span>
            <span className="text-caption text-text-tertiary">
              평균 {detail.avg_rating?.toFixed(1) || "-"}점
            </span>
          </div>
        </div>

        {/* Rating */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <h3 className="text-caption font-semibold text-text-primary mb-2">
            문제 평가
          </h3>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                onClick={() => submitVote(r)}
                className={`p-1 ${
                  r <= myRating ? "text-yellow-500" : "text-text-tertiary"
                }`}
              >
                <Star size={24} fill={r <= myRating ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
        </div>

        {/* Solutions */}
        <div className="mb-4">
          <h3 className="text-body font-semibold text-text-primary mb-3">
            풀이 ({solutions.length})
          </h3>
          {solutions.length === 0 ? (
            <div className="bg-bg-primary rounded-lg border border-border-default p-4 text-center">
              <p className="text-caption text-text-tertiary">
                아직 풀이가 없습니다.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {solutions.map((sol) => (
                <div
                  key={sol.id}
                  className="bg-bg-primary rounded-lg border border-border-default p-3"
                >
                  <p className="text-body text-text-primary whitespace-pre-wrap">
                    {sol.content}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    {sol.user_name && (
                      <span className="text-caption text-text-tertiary">
                        {sol.user_name}
                      </span>
                    )}
                    {sol.created_at && (
                      <span className="text-caption text-text-tertiary">
                        {new Date(sol.created_at).toLocaleDateString("ko-KR")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit Solution */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <h3 className="text-caption font-semibold text-text-primary mb-2">
            풀이 작성
          </h3>
          <textarea
            value={newSolution}
            onChange={(e) => setNewSolution(e.target.value)}
            rows={4}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-secondary text-text-primary resize-none mb-2"
            placeholder="풀이를 작성하세요."
          />
          <button
            onClick={submitSolution}
            disabled={submitting || !newSolution.trim()}
            className="w-full py-2 bg-accent text-white rounded-lg text-caption font-medium disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <Send size={14} />
            {submitting ? "제출 중..." : "풀이 제출"}
          </button>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-title text-text-primary">커뮤니티</h1>
        <button
          onClick={() => setViewMode("create")}
          className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-lg text-caption font-medium"
        >
          <Plus size={14} />
          출제하기
        </button>
      </div>

      {/* Subject Filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => {
            setSubject("");
            setPage(1);
          }}
          className={`px-3 py-1 rounded-full text-caption border transition ${
            !subject
              ? "bg-accent text-white border-accent"
              : "bg-bg-primary text-text-secondary border-border-default"
          }`}
        >
          전체
        </button>
        {SUBJECTS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setSubject(s);
              setPage(1);
            }}
            className={`px-3 py-1 rounded-full text-caption border transition ${
              subject === s
                ? "bg-accent text-white border-accent"
                : "bg-bg-primary text-text-secondary border-border-default"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Problem Cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-bg-primary rounded-lg border border-border-default p-4 animate-pulse"
            >
              <div className="h-4 bg-bg-secondary rounded w-3/4 mb-2" />
              <div className="h-3 bg-bg-secondary rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : problems.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <Users size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">출제된 문제가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {problems.map((p) => (
            <button
              key={p.id}
              onClick={() => openDetail(p.id)}
              className="w-full text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition"
            >
              <div className="flex items-center gap-2 mb-1">
                {p.subject && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                    {p.subject}
                  </span>
                )}
                {p.difficulty && (
                  <span className="text-[11px] text-yellow-500">
                    {"★".repeat(p.difficulty)}
                  </span>
                )}
              </div>
              <h3 className="text-body font-medium text-text-primary mb-1">
                {p.title}
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-caption text-text-tertiary">
                  풀이 {p.solve_count || 0}
                </span>
                <span className="text-caption text-text-tertiary flex items-center gap-0.5">
                  <ThumbsUp size={11} />
                  {p.vote_count || 0}
                </span>
                {p.avg_rating != null && p.avg_rating > 0 && (
                  <span className="text-caption text-text-tertiary flex items-center gap-0.5">
                    <Star size={11} />
                    {p.avg_rating.toFixed(1)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded border border-border-default text-caption text-text-secondary disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded border border-border-default text-caption text-text-secondary disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
