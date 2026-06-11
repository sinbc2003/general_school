"use client";

/**
 * 라이브 퀴즈 — 호스트(교사) 진행 화면.
 *
 * 2초 폴링 GET /api/tools/quiz/sessions/{sid}.
 * lobby(PIN+QR+참가자) → question(카운트다운+제출 현황) → reveal(정답·분포·리더보드)
 * → ... → ended(포디움).
 *
 * 타이머는 서버 시각 보정(server_now - client now offset)으로 계산.
 * 시간 종료 또는 전원 제출 시 자동 공개 (문제당 1회 가드).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2, Users, Play, Eye, ArrowRight, Square, Trophy, Crown, ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToolFocusMode } from "@/lib/use-tool-focus";
import { openToolWindow } from "@/lib/open-tool-window";
import { ProblemContent, InlineMathText } from "@/components/courseware/ProblemContent";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

const CHOICE_COLORS = [
  "bg-red-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-purple-500", "bg-pink-500", "bg-cyan-600", "bg-orange-500",
];
const CHOICE_SHAPES = ["▲", "◆", "●", "■", "★", "♥", "♣", "♦"];

interface PlayerRow { id: number; nickname: string; score: number }
interface LeaderRow { rank: number; nickname: string; score: number }

interface HostState {
  id: number;
  title: string;
  pin: string;
  join_url: string;
  status: "lobby" | "question" | "reveal" | "ended";
  current_index: number;
  total: number;
  time_limit: number;
  question_started_at: string | null;
  server_now: string;
  player_count: number;
  players: PlayerRow[];
  current_problem?: {
    id: number; type: string; content: string;
    choices?: string[]; answer?: string | null; correct?: string[] | string | null;
  };
  answered_count?: number;
  correct_display?: string | null;
  correct_count?: number;
  distribution?: Record<string, number>;
  leaderboard?: LeaderRow[];
}

export default function QuizHostPage() {
  const params = useParams<{ sid: string }>();
  const router = useRouter();
  const sid = Number(params.sid);
  useToolFocusMode();

  const [st, setSt] = useState<HostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const offsetRef = useRef(0); // serverNow - clientNow
  const autoRevealedIndex = useRef(-1);
  const busyRef = useRef(false);

  // ── 폴링 ──────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const res = await api.get<HostState>(`/api/tools/quiz/sessions/${sid}`);
      offsetRef.current = new Date(res.server_now).getTime() - Date.now();
      setSt(res);
      setError(null);
    } catch (e: any) {
      setError(e?.detail || "세션을 불러올 수 없습니다");
    }
  }, [sid]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [poll]);

  // ── QR (인증 fetch → blob) ────────────────────────────────────────────
  useEffect(() => {
    let url: string | null = null;
    (async () => {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
        const r = await fetch(`${API_URL}/api/tools/quiz/sessions/${sid}/qr.png`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (r.ok) {
          url = URL.createObjectURL(await r.blob());
          setQrUrl(url);
        }
      } catch { /* QR 없이도 진행 가능 */ }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [sid]);

  // ── 카운트다운 (250ms tick) ───────────────────────────────────────────
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

  // ── 전이 액션 ─────────────────────────────────────────────────────────
  const act = useCallback(async (action: "start" | "reveal" | "next" | "end") => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await api.post(`/api/tools/quiz/sessions/${sid}/${action}`);
      await poll();
    } catch (e: any) {
      // 409 (이미 전이됨)는 폴링이 곧 따라잡음 — 무시
      if (e?.status !== 409) alert(e?.detail || "동작 실패");
    } finally {
      busyRef.current = false;
    }
  }, [sid, poll]);

  // ── 자동 공개: 시간 종료 or 전원 제출 ─────────────────────────────────
  useEffect(() => {
    if (!st || st.status !== "question") return;
    if (autoRevealedIndex.current === st.current_index) return;
    const timeUp = remainingMs !== null && remainingMs <= 0;
    const allAnswered =
      st.player_count > 0 && (st.answered_count ?? 0) >= st.player_count;
    if (timeUp || allAnswered) {
      autoRevealedIndex.current = st.current_index;
      act("reveal");
    }
  }, [st, remainingMs, act]);

  if (error && !st) {
    return (
      <div className="p-10 text-center">
        <div className="text-body text-status-error mb-3">{error}</div>
        <button onClick={() => router.push("/tools/quiz")} className="text-caption underline">
          목록으로
        </button>
      </div>
    );
  }
  if (!st) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 상단 바 */}
      <div className="flex items-center justify-between mb-5">
        <div className="min-w-0">
          <h1 className="text-body font-semibold truncate">{st.title}</h1>
          <div className="text-caption text-text-tertiary">
            {st.status === "lobby"
              ? "대기실"
              : st.status === "ended"
                ? "종료됨"
                : `문제 ${st.current_index + 1} / ${st.total}`}
            {" · "}
            <span className="inline-flex items-center gap-1">
              <Users size={12} /> {st.player_count}명
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {st.status !== "ended" && (
            <span className="font-mono text-lg font-bold text-violet-700 tracking-[0.3em] bg-violet-50 border border-violet-200 rounded px-3 py-1">
              {st.pin}
            </span>
          )}
          <button
            onClick={() => openToolWindow(`/tools/quiz/${sid}/host`)}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-border-default rounded text-caption text-text-secondary hover:bg-bg-secondary"
            title="새 창에서 열기 (프로젝터)"
          >
            <ExternalLink size={13} /> 새 창
          </button>
          {st.status !== "ended" && (
            <button
              onClick={() => { if (confirm("퀴즈를 종료할까요?")) act("end"); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-border-default rounded text-caption text-text-secondary hover:bg-bg-secondary"
            >
              <Square size={13} /> 종료
            </button>
          )}
        </div>
      </div>

      {st.status === "lobby" && (
        <LobbyView st={st} qrUrl={qrUrl} onStart={() => act("start")} />
      )}
      {st.status === "question" && (
        <QuestionView st={st} remainingMs={remainingMs} onReveal={() => act("reveal")} />
      )}
      {st.status === "reveal" && (
        <RevealView st={st} onNext={() => act("next")} />
      )}
      {st.status === "ended" && (
        <EndedView st={st} onBack={() => router.push("/tools/quiz")} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function LobbyView({
  st, qrUrl, onStart,
}: { st: HostState; qrUrl: string | null; onStart: () => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="border border-border-default rounded-xl p-8 bg-bg-primary text-center">
        <div className="text-caption text-text-tertiary mb-2">참여 PIN</div>
        <div className="font-mono text-6xl font-extrabold tracking-[0.2em] text-violet-700 mb-5">
          {st.pin}
        </div>
        {qrUrl && (
          <img
            src={qrUrl}
            alt="입장 QR"
            className="mx-auto w-44 h-44 border border-border-default rounded-lg mb-4"
          />
        )}
        <div className="text-caption text-text-tertiary break-all">{st.join_url}</div>
        <button
          onClick={onStart}
          disabled={st.player_count === 0}
          className="mt-6 inline-flex items-center gap-2 px-8 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl text-lg font-semibold"
        >
          <Play size={20} /> 시작 ({st.player_count}명)
        </button>
        {st.player_count === 0 && (
          <div className="text-caption text-text-tertiary mt-2">
            참가자가 입장하면 시작할 수 있습니다
          </div>
        )}
      </div>

      <div className="border border-border-default rounded-xl p-5 bg-bg-primary">
        <div className="text-caption font-semibold text-text-secondary mb-3 flex items-center gap-1.5">
          <Users size={14} /> 참가자 {st.player_count}명
        </div>
        {st.players.length === 0 ? (
          <div className="text-caption text-text-tertiary py-8 text-center">
            아직 아무도 입장하지 않았습니다
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {st.players.map((p) => (
              <span
                key={p.id}
                className="px-2.5 py-1 bg-violet-50 border border-violet-200 rounded-full text-caption"
              >
                {p.nickname}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionView({
  st, remainingMs, onReveal,
}: { st: HostState; remainingMs: number | null; onReveal: () => void }) {
  const p = st.current_problem;
  const limitMs = st.time_limit * 1000;
  const pct = remainingMs !== null ? Math.max(0, Math.min(100, (remainingMs / limitMs) * 100)) : 100;
  const secs = remainingMs !== null ? Math.ceil(remainingMs / 1000) : st.time_limit;

  return (
    <div>
      {/* 타이머 바 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-3 bg-bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full transition-[width] duration-200 ${pct > 30 ? "bg-violet-500" : "bg-red-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`font-mono text-xl font-bold w-12 text-right ${secs <= 5 ? "text-red-600" : "text-text-primary"}`}>
          {secs}
        </span>
      </div>

      <div className="border border-border-default rounded-xl p-6 bg-bg-primary mb-4">
        {p && <ProblemContent content={p.content} className="text-xl whitespace-pre-wrap" />}
        {p?.choices && p.choices.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-5">
            {p.choices.map((c, i) => (
              <div
                key={i}
                className={`${CHOICE_COLORS[i % CHOICE_COLORS.length]} text-white rounded-lg px-4 py-3 flex items-center gap-3`}
              >
                <span className="text-lg">{CHOICE_SHAPES[i % CHOICE_SHAPES.length]}</span>
                <span className="text-body font-medium"><InlineMathText text={c} /></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-body text-text-secondary">
          제출 <span className="font-bold text-violet-700">{st.answered_count ?? 0}</span>
          {" / "}{st.player_count}명
        </div>
        <button
          onClick={onReveal}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium"
        >
          <Eye size={17} /> 정답 공개
        </button>
      </div>
    </div>
  );
}

function RevealView({ st, onNext }: { st: HostState; onNext: () => void }) {
  const p = st.current_problem;
  const answered = st.answered_count ?? 0;
  const dist = st.distribution || {};
  const maxCount = Math.max(1, ...Object.values(dist));
  const isLast = st.current_index + 1 >= st.total;

  return (
    <div>
      <div className="border border-border-default rounded-xl p-6 bg-bg-primary mb-4">
        {p && <ProblemContent content={p.content} className="text-lg whitespace-pre-wrap mb-4" />}

        <div className="bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-3 mb-4">
          <span className="text-caption text-emerald-700 font-semibold mr-2">정답</span>
          <span className="text-body font-bold text-emerald-900">
            {st.correct_display ? <InlineMathText text={st.correct_display} /> : "—"}
          </span>
          <span className="text-caption text-text-tertiary ml-3">
            정답자 {st.correct_count ?? 0} / 제출 {answered}명
          </span>
        </div>

        {/* 객관식 분포 */}
        {p?.choices && p.choices.length > 0 && (
          <div className="space-y-2">
            {p.choices.map((c, i) => {
              const letter = String.fromCharCode(65 + i);
              const cnt = dist[letter] || 0;
              const correctSet = Array.isArray(p.correct) ? p.correct : p.correct ? [String(p.correct)] : [];
              const isCorrect = correctSet.includes(letter);
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className={`${CHOICE_COLORS[i % CHOICE_COLORS.length]} text-white rounded w-7 h-7 flex items-center justify-center text-caption flex-shrink-0`}>
                    {CHOICE_SHAPES[i % CHOICE_SHAPES.length]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-6 rounded ${isCorrect ? "bg-emerald-500" : "bg-bg-secondary border border-border-default"}`}
                        style={{ width: `${Math.max(4, (cnt / maxCount) * 100)}%` }}
                      />
                      <span className="text-caption font-mono">{cnt}</span>
                      {isCorrect && <span className="text-emerald-600 text-caption font-bold">✓</span>}
                    </div>
                    <div className="text-caption text-text-tertiary truncate">
                      <InlineMathText text={c} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 리더보드 */}
      {st.leaderboard && st.leaderboard.length > 0 && (
        <div className="border border-border-default rounded-xl p-5 bg-bg-primary mb-4">
          <div className="text-caption font-semibold text-text-secondary mb-2 flex items-center gap-1.5">
            <Trophy size={14} className="text-amber-500" /> 리더보드
          </div>
          <Leaderboard rows={st.leaderboard} />
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium"
        >
          {isLast ? <>최종 결과 <Trophy size={17} /></> : <>다음 문제 <ArrowRight size={17} /></>}
        </button>
      </div>
    </div>
  );
}

function EndedView({ st, onBack }: { st: HostState; onBack: () => void }) {
  const lb = st.leaderboard || [];
  const podium = lb.slice(0, 3);
  return (
    <div>
      {/* 포디움 */}
      <div className="flex items-end justify-center gap-4 py-8">
        {[1, 0, 2].map((idx) => {
          const row = podium[idx];
          if (!row) return <div key={idx} className="w-36" />;
          const heights = ["h-40", "h-28", "h-20"];
          const colors = ["bg-amber-400", "bg-gray-300", "bg-orange-300"];
          return (
            <div key={idx} className="w-36 text-center">
              {idx === 0 && <Crown size={28} className="mx-auto text-amber-500 mb-1" />}
              <div className="text-body font-bold truncate mb-1">{row.nickname}</div>
              <div className="text-caption text-text-secondary mb-2">{row.score}점</div>
              <div className={`${heights[idx]} ${colors[idx]} rounded-t-xl flex items-start justify-center pt-2 text-white text-2xl font-extrabold`}>
                {row.rank}
              </div>
            </div>
          );
        })}
      </div>

      {lb.length > 3 && (
        <div className="border border-border-default rounded-xl p-5 bg-bg-primary mb-4 max-w-lg mx-auto">
          <Leaderboard rows={lb.slice(3)} />
        </div>
      )}

      <div className="text-center">
        <button
          onClick={onBack}
          className="px-6 py-2.5 border border-border-default rounded-lg text-body hover:bg-bg-secondary"
        >
          목록으로
        </button>
      </div>
    </div>
  );
}

function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  return (
    <ol className="space-y-1">
      {rows.map((r) => (
        <li key={r.rank} className="flex items-center gap-3 px-2 py-1 rounded hover:bg-bg-secondary">
          <span className="font-mono text-caption text-text-tertiary w-6 text-right">{r.rank}</span>
          <span className="text-body flex-1 truncate">{r.nickname}</span>
          <span className="font-mono text-body font-semibold">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}
