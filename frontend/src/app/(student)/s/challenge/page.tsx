"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Flame, Lock, CheckCircle, ArrowLeft, Star } from "lucide-react";

interface Level {
  id: number;
  category: string;
  title: string;
  level_number: number;
  unlock_threshold: number;
  problem_count: number;
}

interface ChallengeProblem {
  id: number;
  content: string;
  difficulty: number;
  points: number;
  source_name?: string;
}

interface Progress {
  problem_id: number;
  status: string;
  score: number;
  solved_at: string;
}

export default function ChallengePage() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [category, setCategory] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [problems, setProblems] = useState<ChallengeProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [solvingId, setSolvingId] = useState<number | null>(null);

  const totalPoints = progress.reduce((sum, p) => sum + (p.score || 0), 0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [levelsData, progressData] = await Promise.all([
        api.get(
          `/api/challenge/levels${category ? `?category=${encodeURIComponent(category)}` : ""}`
        ),
        api.get("/api/challenge/my-progress"),
      ]);
      setLevels(levelsData || []);
      setProgress(progressData || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const loadLevelProblems = async (level: Level) => {
    setSelectedLevel(level);
    try {
      const data = await api.get(`/api/challenge/levels/${level.id}/problems`);
      setProblems(data || []);
    } catch {
      setProblems([]);
    }
  };

  const solveProblem = async (problemId: number) => {
    setSolvingId(problemId);
    try {
      await api.post(`/api/challenge/problems/${problemId}/solve`, {
        status: "solved",
        score: 10,
      });
      const progressData = await api.get("/api/challenge/my-progress");
      setProgress(progressData || []);
    } catch {
      alert("풀이 제출에 실패했습니다.");
    } finally {
      setSolvingId(null);
    }
  };

  const isLevelUnlocked = (level: Level) => totalPoints >= level.unlock_threshold;
  const isProblemSolved = (problemId: number) =>
    progress.some((p) => p.problem_id === problemId && p.status === "solved");

  const categories = Array.from(new Set(levels.map((l) => l.category).filter(Boolean)));

  // Level detail view
  if (selectedLevel) {
    return (
      <div>
        <button
          onClick={() => {
            setSelectedLevel(null);
            setProblems([]);
          }}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="mb-4">
          <h1 className="text-title text-text-primary">{selectedLevel.title}</h1>
          <p className="text-caption text-text-tertiary">
            레벨 {selectedLevel.level_number} | 문제 {selectedLevel.problem_count}개
          </p>
        </div>

        {problems.length === 0 ? (
          <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
            <p className="text-body text-text-tertiary">문제가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {problems.map((problem, idx) => {
              const solved = isProblemSolved(problem.id);
              return (
                <div
                  key={problem.id}
                  className={`bg-bg-primary rounded-lg border p-4 ${
                    solved ? "border-green-300" : "border-border-default"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-caption font-semibold text-text-tertiary">
                        #{idx + 1}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-600">
                        {problem.points}점
                      </span>
                      {problem.difficulty > 0 && (
                        <span className="text-[11px] text-yellow-500">
                          {"★".repeat(problem.difficulty)}
                        </span>
                      )}
                    </div>
                    {solved && <CheckCircle size={18} className="text-green-500" />}
                  </div>
                  <p className="text-body text-text-primary whitespace-pre-wrap mb-3">
                    {problem.content}
                  </p>
                  {problem.source_name && (
                    <p className="text-caption text-text-tertiary mb-2">
                      출처: {problem.source_name}
                    </p>
                  )}
                  {!solved && (
                    <button
                      onClick={() => solveProblem(problem.id)}
                      disabled={solvingId === problem.id}
                      className="w-full py-2 bg-accent text-white rounded-lg text-caption font-medium disabled:opacity-50"
                    >
                      {solvingId === problem.id ? "제출 중..." : "풀이 완료"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Level list view
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-title text-text-primary">챌린지</h1>
        <div className="flex items-center gap-1 bg-bg-primary rounded-full px-3 py-1 border border-border-default">
          <Star size={14} className="text-yellow-500" />
          <span className="text-caption font-semibold text-text-primary">
            {totalPoints}점
          </span>
        </div>
      </div>

      {/* Category Chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setCategory("")}
            className={`px-3 py-1 rounded-full text-caption border transition ${
              !category
                ? "bg-accent text-white border-accent"
                : "bg-bg-primary text-text-secondary border-border-default"
            }`}
          >
            전체
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1 rounded-full text-caption border transition ${
                category === c
                  ? "bg-accent text-white border-accent"
                  : "bg-bg-primary text-text-secondary border-border-default"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-bg-primary rounded-lg border border-border-default p-4 animate-pulse"
            >
              <div className="h-5 bg-bg-secondary rounded w-1/2 mb-2" />
              <div className="h-3 bg-bg-secondary rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : levels.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <Flame size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">챌린지 레벨이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {levels.map((level) => {
            const unlocked = isLevelUnlocked(level);
            return (
              <button
                key={level.id}
                onClick={() => unlocked && loadLevelProblems(level)}
                disabled={!unlocked}
                className={`w-full text-left bg-bg-primary rounded-lg border p-4 transition ${
                  unlocked
                    ? "border-border-default hover:border-accent"
                    : "border-border-default opacity-60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-caption font-semibold text-accent">
                        Lv.{level.level_number}
                      </span>
                      <span className="text-body font-medium text-text-primary">
                        {level.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {level.category && (
                        <span className="text-caption text-text-tertiary">
                          {level.category}
                        </span>
                      )}
                      <span className="text-caption text-text-tertiary">
                        문제 {level.problem_count}개
                      </span>
                      {!unlocked && (
                        <span className="text-caption text-text-tertiary">
                          잠금해제: {level.unlock_threshold}점
                        </span>
                      )}
                    </div>
                  </div>
                  {unlocked ? (
                    <Flame size={20} className="text-orange-500" />
                  ) : (
                    <Lock size={20} className="text-text-tertiary" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
