"use client";

/**
 * 라이브 퀴즈 — 학생 플레이 화면.
 *
 * 마운트 시 POST /api/tools/quiz/join {pin} (멱등 — 재입장 OK) → session_id.
 * 이후 2초 폴링 GET /api/tools/quiz/play/{sid}/state.
 *
 * lobby(대기) → question(보기 버튼/입력 + 제출) → 제출 후 대기 → reveal(내 결과+순위)
 * → ... → ended(최종 순위).
 * 제출 응답의 정답 여부는 화면에 안 보여줌 — reveal에서 공개 (Kahoot식 서스펜스).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Hourglass, CheckCircle2, XCircle, Trophy, Send, MinusCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { ProblemContent, InlineMathText } from "@/components/courseware/ProblemContent";

const CHOICE_COLORS = [
  "bg-red-500 hover:bg-red-600", "bg-blue-500 hover:bg-blue-600",
  "bg-amber-500 hover:bg-amber-600", "bg-emerald-500 hover:bg-emerald-600",
  "bg-purple-500 hover:bg-purple-600", "bg-pink-500 hover:bg-pink-600",
  "bg-cyan-600 hover:bg-cyan-700", "bg-orange-500 hover:bg-orange-600",
];
const CHOICE_SHAPES = ["▲", "◆", "●", "■", "★", "♥", "♣", "♦"];

interface LeaderRow { rank: number; nickname: string; score: number }

interface PlayState {
  id: number;
  title: string;
  status: "lobby" | "question" | "reveal" | "ended";
  current_index: number;
  total: number;
  time_limit: number;
  question_started_at: string | null;
  server_now: string;
  player_count: number;
  me: { player_id: number; nickname: string; score: number; rank: number | null };
  question?: { id: number; type: string; content: string; choices?: string[] };
  my_answered?: boolean;
  correct_display?: string | null;
  my_result?: { is_correct: boolean | null; points: number; answer: any } | null;
  leaderboard?: LeaderRow[];
}

export default function QuizPlayPage() {
  const params = useParams<{ pin: string }>();
  const router = useRouter();
  const pin = params.pin;

  const [sid, setSid] = useState<number | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [st, setSt] = useState<PlayState | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const offsetRef = useRef(0);

  // 답안 draft (문제 바뀌면 리셋)
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [numValue, setNumValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localSubmitted, setLocalSubmitted] = useState(false);
  const lastIndexRef = useRef(-1);

  // ── 입장 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post<{ session_id: number }>("/api/tools/quiz/join", { pin });
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
      const res = await api.get<PlayState>(`/api/tools/quiz/play/${sid}/state`);
      offsetRef.current = new Date(res.server_now).getTime() - Date.now();
      setSt(res);
    } catch { /* 일시 오류는 다음 tick */ }
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [sid, poll]);

  // ── 문제 바뀌면 draft 리셋 ────────────────────────────────────────────
  useEffect(() => {
    if (!st) return;
    if (st.current_index !== lastIndexRef.current) {
      lastIndexRef.current = st.current_index;
      setSelected([]);
      setText("");
      setNumValue("");
      setLocalSubmitted(false);
    }
  }, [st?.current_index, st]);

  // ── 카운트다운 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!st || st.status !== "question" || !st.question_started_at) {
      setRemainingMs(null);
      return;
    }
    const startedMs = new Date(st.question_started_at).getTime();
    const limitMs = st.time_limit * 1000;
    const tick = () => {
      const now = Date.now() + offsetRef.current;
      setRemainingMs(Math.max(0, limitMs - (now - startedMs)));
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [st?.status, st?.question_started_at, st?.time_limit]);

  // ── 제출 ──────────────────────────────────────────────────────────────
  const submit = useCallback(async (answer: Record<string, any>) => {
    if (!sid || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/api/tools/quiz/play/${sid}/answer`, { answer });
      setLocalSubmitted(true);
    } catch (e: any) {
      if (e?.status === 409) setLocalSubmitted(true); // 이미 제출/시간초과 — reveal 대기
      else alert(e?.detail || "제출 실패");
    } finally {
      setSubmitting(false);
    }
  }, [sid, submitting]);

  // ── 렌더 ──────────────────────────────────────────────────────────────
  if (joinError) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <XCircle size={40} className="text-status-error mb-3" />
        <div className="text-body mb-4">{joinError}</div>
        <button onClick={() => router.push("/s/quiz")} className="text-caption underline">
          PIN 다시 입력
        </button>
      </div>
    );
  }
  if (!st) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 입장 중...
      </div>
    );
  }

  const answered = localSubmitted || !!st.my_answered;
  const timeUp = remainingMs !== null && remainingMs <= 0;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* 상단: 제목 + 내 점수 */}
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <div className="text-body font-semibold truncate">{st.title}</div>
          <div className="text-caption text-text-tertiary">
            {st.status === "lobby" ? "대기실" : `문제 ${st.current_index + 1} / ${st.total}`}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-mono text-lg font-bold text-violet-700">
            {st.me.score}점
          </div>
          {st.me.rank && (
            <div className="text-caption text-text-tertiary">{st.me.rank}위</div>
          )}
        </div>
      </div>

      {st.status === "lobby" && (
        <div className="text-center py-16">
          <Hourglass size={36} className="mx-auto text-violet-500 mb-3 animate-pulse" />
          <div className="text-body font-medium mb-1">입장 완료!</div>
          <div className="text-caption text-text-tertiary">
            {st.me.nickname}님, 선생님이 시작할 때까지 기다려주세요
            <br />현재 {st.player_count}명 참여 중
          </div>
        </div>
      )}

      {st.status === "question" && st.question && (
        <div>
          {/* 타이머 */}
          {remainingMs !== null && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-2.5 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-200 ${
                    remainingMs / (st.time_limit * 1000) > 0.3 ? "bg-violet-500" : "bg-red-500"
                  }`}
                  style={{ width: `${Math.min(100, (remainingMs / (st.time_limit * 1000)) * 100)}%` }}
                />
              </div>
              <span className={`font-mono font-bold ${Math.ceil(remainingMs / 1000) <= 5 ? "text-red-600" : ""}`}>
                {Math.ceil(remainingMs / 1000)}
              </span>
            </div>
          )}

          {answered ? (
            <div className="text-center py-16">
              <CheckCircle2 size={36} className="mx-auto text-emerald-500 mb-3" />
              <div className="text-body font-medium">제출 완료!</div>
              <div className="text-caption text-text-tertiary mt-1">결과 공개를 기다려주세요</div>
            </div>
          ) : timeUp ? (
            <div className="text-center py-16">
              <Hourglass size={36} className="mx-auto text-text-tertiary mb-3" />
              <div className="text-body font-medium">시간 종료</div>
              <div className="text-caption text-text-tertiary mt-1">결과 공개를 기다려주세요</div>
            </div>
          ) : (
            <div>
              <div className="border border-border-default rounded-xl p-4 bg-bg-primary mb-4">
                <ProblemContent content={st.question.content} className="text-lg whitespace-pre-wrap" />
              </div>

              {st.question.type === "multiple_choice" && st.question.choices && (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                    {st.question.choices.map((c, i) => {
                      const letter = String.fromCharCode(65 + i);
                      const isSel = selected.includes(letter);
                      return (
                        <button
                          key={i}
                          onClick={() =>
                            setSelected((cur) =>
                              cur.includes(letter)
                                ? cur.filter((x) => x !== letter)
                                : [...cur, letter],
                            )
                          }
                          className={`${CHOICE_COLORS[i % CHOICE_COLORS.length]} text-white rounded-xl px-4 py-4 flex items-center gap-3 text-left transition ${
                            isSel ? "ring-4 ring-violet-300 scale-[0.98]" : "opacity-90"
                          }`}
                        >
                          <span className="text-xl flex-shrink-0">
                            {CHOICE_SHAPES[i % CHOICE_SHAPES.length]}
                          </span>
                          <span className="text-body font-medium">
                            <InlineMathText text={c} />
                          </span>
                          {isSel && <CheckCircle2 size={18} className="ml-auto flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => submit({ selected })}
                    disabled={selected.length === 0 || submitting}
                    className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl text-body font-semibold inline-flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    제출
                  </button>
                </div>
              )}

              {st.question.type === "short_answer" && (
                <div className="flex gap-2">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) submit({ text }); }}
                    placeholder="답 입력"
                    autoFocus
                    className="flex-1 px-4 py-3 border-2 border-border-default focus:border-violet-500 rounded-xl outline-none text-body"
                  />
                  <button
                    onClick={() => submit({ text })}
                    disabled={!text.trim() || submitting}
                    className="px-5 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl font-semibold"
                  >
                    <Send size={17} />
                  </button>
                </div>
              )}

              {st.question.type === "numeric" && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="any"
                    value={numValue}
                    onChange={(e) => setNumValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && numValue !== "") submit({ value: parseFloat(numValue) });
                    }}
                    placeholder="숫자 입력"
                    autoFocus
                    className="flex-1 px-4 py-3 border-2 border-border-default focus:border-violet-500 rounded-xl outline-none text-body"
                  />
                  <button
                    onClick={() => submit({ value: parseFloat(numValue) })}
                    disabled={numValue === "" || submitting}
                    className="px-5 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl font-semibold"
                  >
                    <Send size={17} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {st.status === "reveal" && (
        <RevealResult st={st} />
      )}

      {st.status === "ended" && (
        <div className="text-center py-10">
          <Trophy size={40} className="mx-auto text-amber-500 mb-3" />
          <div className="text-title font-bold mb-1">
            {st.me.rank ? `최종 ${st.me.rank}위!` : "퀴즈 종료"}
          </div>
          <div className="text-body text-text-secondary mb-6">{st.me.score}점</div>
          {st.leaderboard && st.leaderboard.length > 0 && (
            <div className="max-w-sm mx-auto border border-border-default rounded-xl p-4 bg-bg-primary text-left">
              <ol className="space-y-1">
                {st.leaderboard.map((r) => (
                  <li
                    key={r.rank}
                    className={`flex items-center gap-3 px-2 py-1 rounded ${
                      r.nickname === st.me.nickname ? "bg-violet-50 font-semibold" : ""
                    }`}
                  >
                    <span className="font-mono text-caption text-text-tertiary w-6 text-right">
                      {r.rank}
                    </span>
                    <span className="text-body flex-1 truncate">{r.nickname}</span>
                    <span className="font-mono text-body">{r.score}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <button
            onClick={() => router.push("/s/quiz")}
            className="mt-6 px-6 py-2.5 border border-border-default rounded-lg text-body hover:bg-bg-secondary"
          >
            나가기
          </button>
        </div>
      )}
    </div>
  );
}

function RevealResult({ st }: { st: PlayState }) {
  const r = st.my_result;
  return (
    <div className="text-center py-8">
      {r == null ? (
        <>
          <MinusCircle size={40} className="mx-auto text-text-tertiary mb-3" />
          <div className="text-title font-bold mb-1">시간 내 제출 못 함</div>
        </>
      ) : r.is_correct ? (
        <>
          <CheckCircle2 size={48} className="mx-auto text-emerald-500 mb-3" />
          <div className="text-title font-bold text-emerald-700 mb-1">정답!</div>
          <div className="text-body font-semibold text-emerald-600">+{r.points}점</div>
        </>
      ) : (
        <>
          <XCircle size={48} className="mx-auto text-red-500 mb-3" />
          <div className="text-title font-bold text-red-700 mb-1">오답</div>
        </>
      )}

      {st.correct_display && (
        <div className="text-caption text-text-secondary mt-3">
          정답: <span className="font-semibold"><InlineMathText text={st.correct_display} /></span>
        </div>
      )}

      <div className="text-body text-text-secondary mt-4">
        내 점수 <span className="font-bold text-violet-700">{st.me.score}점</span>
        {st.me.rank && <> · 현재 <span className="font-bold">{st.me.rank}위</span></>}
      </div>

      {st.leaderboard && st.leaderboard.length > 0 && (
        <div className="max-w-sm mx-auto mt-5 border border-border-default rounded-xl p-4 bg-bg-primary text-left">
          <div className="text-caption font-semibold text-text-secondary mb-2 flex items-center gap-1.5">
            <Trophy size={13} className="text-amber-500" /> TOP 5
          </div>
          <ol className="space-y-1">
            {st.leaderboard.map((row) => (
              <li key={row.rank} className="flex items-center gap-3 px-2 py-0.5">
                <span className="font-mono text-caption text-text-tertiary w-5 text-right">{row.rank}</span>
                <span className="text-body flex-1 truncate">{row.nickname}</span>
                <span className="font-mono text-caption">{row.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="text-caption text-text-tertiary mt-5">다음 문제를 기다려주세요...</div>
    </div>
  );
}
