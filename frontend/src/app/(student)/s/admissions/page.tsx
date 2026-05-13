"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { GraduationCap, ArrowLeft, Eye, EyeOff, Tag } from "lucide-react";

interface AdmissionQuestion {
  id: number;
  title?: string;
  content: string;
  category?: string;
  university?: string;
  year?: number;
  question_type?: string;
}

interface AdmissionDetail extends AdmissionQuestion {
  model_answer?: string;
  tips?: string;
  keywords?: string[];
}

export default function AdmissionsPage() {
  const [questions, setQuestions] = useState<AdmissionQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedQuestion, setSelectedQuestion] =
    useState<AdmissionDetail | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [myAnswer, setMyAnswer] = useState("");

  const pageSize = 10;

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(
        `/api/admissions/questions?page=${page}&page_size=${pageSize}`
      );
      setQuestions(data.items || data || []);
      setTotal(data.total || 0);
    } catch {
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const openQuestion = async (id: number) => {
    try {
      const data = await api.get(`/api/admissions/questions/${id}`);
      setSelectedQuestion(data);
      setShowAnswer(false);
      setMyAnswer("");
    } catch {
      alert("질문을 불러올 수 없습니다.");
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Detail view
  if (selectedQuestion) {
    return (
      <div>
        <button
          onClick={() => setSelectedQuestion(null)}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {selectedQuestion.category && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
                {selectedQuestion.category}
              </span>
            )}
            {selectedQuestion.university && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                {selectedQuestion.university}
              </span>
            )}
            {selectedQuestion.year && (
              <span className="text-[11px] text-text-tertiary">
                {selectedQuestion.year}년
              </span>
            )}
            {selectedQuestion.question_type && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {selectedQuestion.question_type}
              </span>
            )}
          </div>
          {selectedQuestion.title && (
            <h1 className="text-title text-text-primary mb-3">
              {selectedQuestion.title}
            </h1>
          )}
          <p className="text-body text-text-primary whitespace-pre-wrap">
            {selectedQuestion.content}
          </p>
          {selectedQuestion.keywords && selectedQuestion.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border-default">
              <Tag size={12} className="text-text-tertiary" />
              {selectedQuestion.keywords.map((kw, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-secondary"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Practice Area */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <h3 className="text-body font-semibold text-text-primary mb-2">
            나의 답변 연습
          </h3>
          <textarea
            value={myAnswer}
            onChange={(e) => setMyAnswer(e.target.value)}
            rows={8}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-secondary text-text-primary resize-none"
            placeholder="답변을 작성해보세요. 작성 후 모범 답안과 비교하세요."
          />
        </div>

        {/* Model Answer */}
        {selectedQuestion.model_answer && (
          <div className="bg-bg-primary rounded-lg border border-border-default p-4">
            <button
              onClick={() => setShowAnswer(!showAnswer)}
              className="flex items-center gap-1 text-body font-semibold text-text-primary mb-2"
            >
              {showAnswer ? (
                <>
                  <EyeOff size={16} className="text-accent" />
                  모범 답안 숨기기
                </>
              ) : (
                <>
                  <Eye size={16} className="text-accent" />
                  모범 답안 보기
                </>
              )}
            </button>
            {showAnswer && (
              <div>
                <p className="text-body text-text-primary whitespace-pre-wrap">
                  {selectedQuestion.model_answer}
                </p>
                {selectedQuestion.tips && (
                  <div className="mt-3 pt-3 border-t border-border-default">
                    <h4 className="text-caption font-semibold text-text-secondary mb-1">
                      TIP
                    </h4>
                    <p className="text-caption text-text-secondary">
                      {selectedQuestion.tips}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">입시 준비</h1>

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
      ) : questions.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <GraduationCap
            size={32}
            className="mx-auto text-text-tertiary mb-2"
          />
          <p className="text-body text-text-tertiary">
            등록된 기출 문제가 없습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <button
              key={q.id}
              onClick={() => openQuestion(q.id)}
              className="w-full text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition"
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {q.category && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
                    {q.category}
                  </span>
                )}
                {q.university && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                    {q.university}
                  </span>
                )}
                {q.year && (
                  <span className="text-[11px] text-text-tertiary">
                    {q.year}
                  </span>
                )}
              </div>
              <p className="text-body text-text-primary line-clamp-2">
                {q.title || q.content.slice(0, 100)}
              </p>
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
