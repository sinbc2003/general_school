"use client";

/**
 * 실시간 투표 — 학생 참여 화면.
 *
 * 마운트 시 POST /api/tools/poll/join {pin} (멱등 — 재입장 OK) → session_id.
 * 이후 2초 폴링 GET /api/tools/poll/play/{sid}/state.
 *
 * lobby(대기) → question(투표 버튼 / 단어 입력) → 제출 후 "전송됨"
 * (results_to_students=true면 본인 응답 후 실시간 집계도 표시) → ended.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Cloud, Hourglass, Loader2, Send } from "lucide-react";
import { api } from "@/lib/api/client";
import {
  PollResultsView, type PollQuestion, type PollResultsData,
} from "@/components/poll/PollResults";

const CHOICE_COLORS = [
  "bg-teal-600 hover:bg-teal-700", "bg-indigo-500 hover:bg-indigo-600",
  "bg-amber-500 hover:bg-amber-600", "bg-pink-500 hover:bg-pink-600",
  "bg-sky-500 hover:bg-sky-600", "bg-lime-600 hover:bg-lime-700",
  "bg-purple-500 hover:bg-purple-600", "bg-orange-500 hover:bg-orange-600",
  "bg-cyan-600 hover:bg-cyan-700", "bg-slate-500 hover:bg-slate-600",
];

interface PlayState {
  id: number;
  title: string;
  status: "lobby" | "question" | "ended";
  current_index: number;
  total: number;
  results_to_students: boolean;
  question?: PollQuestion;
  my_responded?: boolean;
  my_selected?: string[];
  my_words?: string[];
  my_remaining?: number;
  results?: PollResultsData;
  all_results?: { question: PollQuestion; results: PollResultsData }[];
}

export default function PollPlayPage() {
  const params = useParams<{ pin: string }>();
  const pin = params.pin;

  const [sid, setSid] = useState<number | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [st, setSt] = useState<PlayState | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [word, setWord] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const lastQuestionIdRef = useRef<string | null>(null);

  // ── 입장 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post<{ session_id: number }>("/api/tools/poll/join", { pin });
        if (!cancelled) setSid(res.session_id);
      } catch (e: any) {
        if (!cancelled) setJoinError(e?.detail || "입장할 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, [pin]);

  // ── 폴링 ──────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!sid) return;
    try {
      const res = await api.get<PlayState>(`/api/tools/poll/play/${sid}/state`);
      setSt(res);
    } catch { /* 일시 오류는 다음 tick */ }
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [sid, poll]);

  // ── 질문 바뀌면 draft 리셋 (질문 id 기준 — goto 자유 이동에도 안전) ──
  useEffect(() => {
    const qid = st?.question?.id ?? null;
    if (qid !== lastQuestionIdRef.current) {
      lastQuestionIdRef.current = qid;
      setSelected([]);
      setWord("");
    }
  }, [st?.question?.id]);

  // ── 제출 ──────────────────────────────────────────────────────────────
  const respond = useCallback(async (answer: Record<string, any>) => {
    if (!sid || !st?.question || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/api/tools/poll/play/${sid}/respond`, {
        question_id: st.question.id,
        answer,
      });
      setWord("");
      await poll();
    } catch (e: any) {
      if (e?.status === 409) await poll(); // 이미 제출/질문 전환 — 폴링이 따라잡음
      else alert(e?.detail || "제출 실패");
    } finally {
      setSubmitting(false);
    }
  }, [sid, st?.question, submitting, poll]);

  // ── 렌더 ──────────────────────────────────────────────────────────────
  if (joinError) {
    return (
      <div className="p-10 text-center">
        <div className="text-body text-status-error">{joinError}</div>
        <div className="text-caption text-text-tertiary mt-2">
          PIN을 다시 확인하거나 선생님께 문의하세요
        </div>
      </div>
    );
  }
  if (!st) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 입장 중...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto">
      <div className="text-center mb-5">
        <div className="text-caption text-text-tertiary">{st.title}</div>
        {st.status === "question" && (
          <div className="text-caption text-text-tertiary">
            질문 {st.current_index + 1} / {st.total}
          </div>
        )}
      </div>

      {st.status === "lobby" && (
        <div className="text-center py-16">
          <Hourglass size={36} className="mx-auto text-teal-600 mb-4 animate-pulse" />
          <div className="text-lg font-semibold mb-1">입장 완료!</div>
          <div className="text-body text-text-secondary">곧 시작합니다 — 잠시만 기다려 주세요</div>
        </div>
      )}

      {st.status === "question" && st.question && (
        <div>
          <div className="text-xl sm:text-2xl font-bold text-center mb-6 whitespace-pre-wrap">
            {st.question.prompt}
          </div>

          {st.question.type === "choice" ? (
            <ChoiceAnswer
              question={st.question}
              responded={!!st.my_responded}
              mySelected={st.my_selected || []}
              selected={selected}
              setSelected={setSelected}
              submitting={submitting}
              onSubmit={(sel) => respond({ selected: sel })}
            />
          ) : (
            <WordAnswer
              remaining={st.my_remaining ?? st.question.max_words ?? 1}
              myWords={st.my_words || []}
              word={word}
              setWord={setWord}
              submitting={submitting}
              onSubmit={() => { if (word.trim()) respond({ word: word.trim() }); }}
            />
          )}

          {/* 본인 응답 후 실시간 집계 (호스트가 허용한 경우만) */}
          {st.results && st.question && (
            <div className="mt-6 border border-border-default rounded-xl bg-bg-primary p-4">
              <PollResultsView question={st.question} results={st.results} compact />
            </div>
          )}
        </div>
      )}

      {st.status === "ended" && (
        <div>
          <div className="text-center py-8">
            <CheckCircle2 size={36} className="mx-auto text-teal-600 mb-3" />
            <div className="text-lg font-semibold">투표가 종료되었습니다</div>
            <div className="text-caption text-text-tertiary mt-1">참여해 주셔서 감사합니다</div>
          </div>
          {(st.all_results || []).map((qr, i) => (
            <div key={qr.question.id || i} className="border border-border-default rounded-xl bg-bg-primary p-4 mb-3">
              <div className="text-body font-semibold mb-3 whitespace-pre-wrap">
                <span className="text-text-tertiary mr-1.5">{i + 1}.</span>
                {qr.question.prompt}
              </div>
              <PollResultsView question={qr.question} results={qr.results} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ChoiceAnswer({
  question, responded, mySelected, selected, setSelected, submitting, onSubmit,
}: {
  question: PollQuestion;
  responded: boolean;
  mySelected: string[];
  selected: string[];
  setSelected: (v: string[]) => void;
  submitting: boolean;
  onSubmit: (sel: string[]) => void;
}) {
  const options = question.options || [];

  if (responded) {
    return (
      <div className="text-center py-6">
        <CheckCircle2 size={28} className="mx-auto text-teal-600 mb-2" />
        <div className="text-body text-text-secondary">
          응답이 전송되었습니다
          {mySelected.length > 0 && (
            <span className="block text-caption text-text-tertiary mt-1">
              내 선택: {mySelected.map((l) => {
                const i = l.charCodeAt(0) - 65;
                return options[i] || l;
              }).join(", ")}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 단일 선택: 탭 즉시 제출 / 복수: 토글 + 제출
  if (!question.multi) {
    return (
      <div className="grid grid-cols-1 gap-2.5">
        {options.map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          return (
            <button
              key={i}
              disabled={submitting}
              onClick={() => onSubmit([letter])}
              className={`${CHOICE_COLORS[i % CHOICE_COLORS.length]} disabled:opacity-50 text-white rounded-xl px-5 py-4 text-left text-body font-medium active:scale-[0.98] transition`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  const toggle = (letter: string) => {
    setSelected(
      selected.includes(letter)
        ? selected.filter((x) => x !== letter)
        : [...selected, letter],
    );
  };

  return (
    <div>
      <div className="text-caption text-text-tertiary text-center mb-2">
        여러 개를 고를 수 있어요
      </div>
      <div className="grid grid-cols-1 gap-2.5 mb-4">
        {options.map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const on = selected.includes(letter);
          return (
            <button
              key={i}
              onClick={() => toggle(letter)}
              className={`rounded-xl px-5 py-4 text-left text-body font-medium border-2 transition ${
                on
                  ? "border-teal-600 bg-teal-50 text-teal-900"
                  : "border-border-default bg-bg-primary text-text-primary hover:bg-bg-secondary"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      <button
        disabled={selected.length === 0 || submitting}
        onClick={() => onSubmit(selected)}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl text-body font-semibold"
      >
        <Send size={16} /> 제출
      </button>
    </div>
  );
}

function WordAnswer({
  remaining, myWords, word, setWord, submitting, onSubmit,
}: {
  remaining: number;
  myWords: string[];
  word: string;
  setWord: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const done = remaining <= 0;
  return (
    <div>
      {myWords.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 mb-4">
          {myWords.map((w, i) => (
            <span
              key={i}
              className="px-3 py-1 bg-teal-50 border border-teal-200 text-teal-800 rounded-full text-caption font-medium"
            >
              {w}
            </span>
          ))}
        </div>
      )}
      {done ? (
        <div className="text-center py-5">
          <CheckCircle2 size={28} className="mx-auto text-teal-600 mb-2" />
          <div className="text-body text-text-secondary">단어를 모두 제출했습니다</div>
        </div>
      ) : (
        <div>
          <div className="flex gap-2">
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
              maxLength={30}
              placeholder="단어 입력"
              className="flex-1 border-2 border-teal-300 focus:border-teal-600 rounded-xl px-4 py-3 text-lg text-center focus:outline-none"
            />
            <button
              disabled={!word.trim() || submitting}
              onClick={onSubmit}
              className="inline-flex items-center gap-1.5 px-5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl text-body font-semibold"
            >
              <Send size={16} />
            </button>
          </div>
          <div className="text-caption text-text-tertiary text-center mt-2 flex items-center justify-center gap-1">
            <Cloud size={12} /> {remaining}개 더 제출할 수 있어요
          </div>
        </div>
      )}
    </div>
  );
}
