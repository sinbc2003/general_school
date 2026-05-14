"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { BookOpen, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";

interface Problem {
  id: number;
  title?: string;
  content: string;
  solution?: string;
  answer?: string;
  subject?: string;
  difficulty?: number;
  source_name?: string;
  question_type?: string;
}

interface PaginatedResponse {
  items: Problem[];
  total: number;
  page: number;
  page_size: number;
}

const SUBJECTS = ["수학", "물리", "화학", "생명과학", "지구과학", "정보"];
const DIFFICULTIES = [
  { value: 1, label: "1 (기초)" },
  { value: 2, label: "2 (쉬움)" },
  { value: 3, label: "3 (보통)" },
  { value: 4, label: "4 (어려움)" },
  { value: 5, label: "5 (최상)" },
];

export default function ProblemsPage() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showSolution, setShowSolution] = useState<Record<number, boolean>>({});

  const pageSize = 10;

  const fetchProblems = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/archive/problems?page=${page}&page_size=${pageSize}`;
      if (subject) url += `&subject=${encodeURIComponent(subject)}`;
      if (difficulty) url += `&difficulty=${difficulty}`;
      const data: PaginatedResponse = await api.get(url);
      setProblems(data.items || []);
      setTotal(data.total || 0);
    } catch {
      setProblems([]);
    } finally {
      setLoading(false);
    }
  }, [page, subject, difficulty]);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  const totalPages = Math.ceil(total / pageSize);

  const toggleSolution = (id: number) => {
    setShowSolution((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const difficultyLabel = (d: number | undefined) => {
    if (!d) return "";
    const stars = "★".repeat(d) + "☆".repeat(5 - d);
    return stars;
  };

  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">문제풀기</h1>

      {/* Filter Chips */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setSubject(""); setPage(1); }}
            className={`px-3 py-1 rounded-full text-caption border transition ${
              !subject
                ? "bg-accent text-white border-accent"
                : "bg-bg-primary text-text-secondary border-border-default"
            }`}
          >
            전체 과목
          </button>
          {SUBJECTS.map((s) => (
            <button
              key={s}
              onClick={() => { setSubject(s); setPage(1); }}
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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setDifficulty(""); setPage(1); }}
            className={`px-3 py-1 rounded-full text-caption border transition ${
              !difficulty
                ? "bg-accent text-white border-accent"
                : "bg-bg-primary text-text-secondary border-border-default"
            }`}
          >
            전체 난이도
          </button>
          {DIFFICULTIES.map((d) => (
            <button
              key={d.value}
              onClick={() => { setDifficulty(String(d.value)); setPage(1); }}
              className={`px-3 py-1 rounded-full text-caption border transition ${
                difficulty === String(d.value)
                  ? "bg-accent text-white border-accent"
                  : "bg-bg-primary text-text-secondary border-border-default"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
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
          <BookOpen size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">문제가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {problems.map((problem) => (
            <div
              key={problem.id}
              className="bg-bg-primary rounded-lg border border-border-default overflow-hidden"
            >
              {/* Card Header */}
              <button
                onClick={() =>
                  setSelectedId(selectedId === problem.id ? null : problem.id)
                }
                className="w-full p-4 text-left"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {problem.subject && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-cream-100 text-blue-600">
                          {problem.subject}
                        </span>
                      )}
                      {problem.difficulty && (
                        <span className="text-[11px] text-yellow-500">
                          {difficultyLabel(problem.difficulty)}
                        </span>
                      )}
                    </div>
                    <p className="text-body text-text-primary line-clamp-2">
                      {problem.title || problem.content?.slice(0, 80) || `문제 #${problem.id}`}
                    </p>
                    {problem.source_name && (
                      <span className="text-caption text-text-tertiary">
                        출처: {problem.source_name}
                      </span>
                    )}
                  </div>
                  {selectedId === problem.id ? (
                    <ChevronUp size={18} className="text-text-tertiary flex-shrink-0" />
                  ) : (
                    <ChevronDown size={18} className="text-text-tertiary flex-shrink-0" />
                  )}
                </div>
              </button>

              {/* Expanded Detail */}
              {selectedId === problem.id && (
                <div className="px-4 pb-4 border-t border-border-default pt-3">
                  <div className="text-body text-text-primary whitespace-pre-wrap mb-3">
                    {problem.content}
                  </div>

                  {(problem.solution || problem.answer) && (
                    <div>
                      <button
                        onClick={() => toggleSolution(problem.id)}
                        className="flex items-center gap-1 text-caption text-accent mb-2"
                      >
                        {showSolution[problem.id] ? (
                          <>
                            <EyeOff size={14} />
                            풀이 숨기기
                          </>
                        ) : (
                          <>
                            <Eye size={14} />
                            풀이 보기
                          </>
                        )}
                      </button>
                      {showSolution[problem.id] && (
                        <div className="bg-bg-secondary rounded-lg p-3">
                          {problem.answer && (
                            <div className="mb-2">
                              <span className="text-caption font-semibold text-text-primary">
                                정답:
                              </span>
                              <span className="text-body text-accent ml-2">
                                {problem.answer}
                              </span>
                            </div>
                          )}
                          {problem.solution && (
                            <div className="text-body text-text-secondary whitespace-pre-wrap">
                              {problem.solution}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
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
