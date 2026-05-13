"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Trophy, ArrowLeft, Calendar, Clock, Send } from "lucide-react";

interface Contest {
  id: number;
  title: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  duration_minutes?: number;
}

interface ContestProblem {
  id: number;
  content: string;
  points?: number;
  order_num?: number;
  difficulty?: number;
}

export default function ContestPage() {
  const [contests, setContests] = useState<Contest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null);
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const pageSize = 10;

  const fetchContests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(
        `/api/contest?page=${page}&page_size=${pageSize}`
      );
      setContests(data.items || data || []);
      setTotal(data.total || 0);
    } catch {
      setContests([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchContests();
  }, [fetchContests]);

  const openContest = async (id: number) => {
    try {
      const [contestData, problemsData] = await Promise.all([
        api.get(`/api/contest/${id}`),
        api.get(`/api/contest/${id}/problems`),
      ]);
      setSelectedContest(contestData);
      setProblems(problemsData?.items || problemsData || []);
      setAnswer("");
      setSubmitted(false);
    } catch {
      alert("대회 정보를 불러올 수 없습니다.");
    }
  };

  const submitAnswer = async () => {
    if (!selectedContest || !answer.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/contest/${selectedContest.id}/submissions`, {
        content: answer,
      });
      setSubmitted(true);
    } catch {
      alert("제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusStyle = (status?: string) => {
    switch (status) {
      case "upcoming":
        return "bg-blue-50 text-blue-600";
      case "active":
      case "in_progress":
        return "bg-green-50 text-green-600";
      case "ended":
      case "finished":
        return "bg-gray-100 text-gray-500";
      default:
        return "bg-gray-100 text-gray-500";
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case "upcoming":
        return "예정";
      case "active":
      case "in_progress":
        return "진행중";
      case "ended":
      case "finished":
        return "종료";
      default:
        return status || "-";
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Detail view
  if (selectedContest) {
    return (
      <div>
        <button
          onClick={() => {
            setSelectedContest(null);
            setProblems([]);
          }}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <h1 className="text-title text-text-primary mb-2">
            {selectedContest.title}
          </h1>
          {selectedContest.description && (
            <p className="text-body text-text-secondary mb-3">
              {selectedContest.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-caption text-text-tertiary">
            {selectedContest.start_time && (
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {new Date(selectedContest.start_time).toLocaleString("ko-KR")}
              </span>
            )}
            {selectedContest.duration_minutes && (
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {selectedContest.duration_minutes}분
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] ${getStatusStyle(
                selectedContest.status
              )}`}
            >
              {getStatusLabel(selectedContest.status)}
            </span>
          </div>
        </div>

        {/* Problems */}
        <h2 className="text-body font-semibold text-text-primary mb-3">
          문제 ({problems.length})
        </h2>
        {problems.length === 0 ? (
          <div className="bg-bg-primary rounded-lg border border-border-default p-6 text-center mb-4">
            <p className="text-body text-text-tertiary">
              문제가 아직 공개되지 않았습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {problems.map((p, idx) => (
              <div
                key={p.id}
                className="bg-bg-primary rounded-lg border border-border-default p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-caption font-semibold text-accent">
                    #{p.order_num ?? idx + 1}
                  </span>
                  {p.points && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-600">
                      {p.points}점
                    </span>
                  )}
                </div>
                <p className="text-body text-text-primary whitespace-pre-wrap">
                  {p.content}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Submit Answer */}
        {problems.length > 0 && (
          <div className="bg-bg-primary rounded-lg border border-border-default p-4">
            <h3 className="text-body font-semibold text-text-primary mb-2">
              답안 제출
            </h3>
            {submitted ? (
              <div className="text-center py-4">
                <Trophy size={32} className="mx-auto text-yellow-500 mb-2" />
                <p className="text-body text-text-primary font-medium">
                  제출 완료!
                </p>
                <p className="text-caption text-text-tertiary">
                  답안이 성공적으로 제출되었습니다.
                </p>
              </div>
            ) : (
              <>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={6}
                  className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-secondary text-text-primary resize-none mb-3"
                  placeholder="답안을 작성하세요."
                />
                <button
                  onClick={submitAnswer}
                  disabled={submitting || !answer.trim()}
                  className="w-full py-2 bg-accent text-white rounded-lg text-body font-medium disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <Send size={16} />
                  {submitting ? "제출 중..." : "답안 제출"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">대회</h1>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-bg-primary rounded-lg border border-border-default p-4 animate-pulse"
            >
              <div className="h-5 bg-bg-secondary rounded w-2/3 mb-2" />
              <div className="h-3 bg-bg-secondary rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : contests.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <Trophy size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">등록된 대회가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {contests.map((c) => (
            <button
              key={c.id}
              onClick={() => openContest(c.id)}
              className="w-full text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition"
            >
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-body font-medium text-text-primary">
                  {c.title}
                </h3>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${getStatusStyle(
                    c.status
                  )}`}
                >
                  {getStatusLabel(c.status)}
                </span>
              </div>
              {c.description && (
                <p className="text-caption text-text-secondary line-clamp-2 mb-2">
                  {c.description}
                </p>
              )}
              <div className="flex items-center gap-3 text-caption text-text-tertiary">
                {c.start_time && (
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    {new Date(c.start_time).toLocaleDateString("ko-KR")}
                  </span>
                )}
                {c.duration_minutes && (
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {c.duration_minutes}분
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

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
