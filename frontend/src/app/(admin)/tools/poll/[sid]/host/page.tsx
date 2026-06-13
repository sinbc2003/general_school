"use client";

/**
 * 실시간 투표 — 호스트(교사) 진행 화면 (Mentimeter 발표 화면식).
 *
 * 2초 폴링 GET /api/tools/poll/sessions/{sid}.
 * lobby(PIN+QR+참여자 수) → question(질문 + 실시간 막대/워드클라우드 + ◀▶ 이동)
 * → ended(전체 질문 결과 스택).
 *
 * 퀴즈와 달리 타이머·점수·정답 없음 — 응답이 들어오는 대로 그래프가 자란다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, ExternalLink, Eye, EyeOff, Loader2, Play,
  Square, Users,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToolFocusMode } from "@/lib/use-tool-focus";
import { openToolWindow } from "@/lib/open-tool-window";
import {
  PollResultsView, type PollQuestion, type PollResultsData,
} from "@/components/poll/PollResults";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface HostState {
  id: number;
  title: string;
  pin: string;
  join_url: string;
  status: "lobby" | "question" | "ended";
  current_index: number;
  total: number;
  participant_count: number;
  results_to_students: boolean;
  current_question?: PollQuestion;
  results?: PollResultsData;
  all_results?: { question: PollQuestion; results: PollResultsData }[];
}

export default function PollHostPage() {
  const params = useParams<{ sid: string }>();
  const router = useRouter();
  const sid = Number(params.sid);
  useToolFocusMode();

  const [st, setSt] = useState<HostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const busyRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const res = await api.get<HostState>(`/api/tools/poll/sessions/${sid}`);
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

  // QR (인증 fetch → blob)
  useEffect(() => {
    let url: string | null = null;
    (async () => {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
        const r = await fetch(`${API_URL}/api/tools/poll/sessions/${sid}/qr.png`, {
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

  const act = useCallback(async (path: string, body?: any) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await api.post(`/api/tools/poll/sessions/${sid}/${path}`, body ?? {});
      await poll();
    } catch (e: any) {
      if (e?.status !== 409) alert(e?.detail || "동작 실패");
    } finally {
      busyRef.current = false;
    }
  }, [sid, poll]);

  if (error && !st) {
    return (
      <div className="p-10 text-center">
        <div className="text-body text-status-error mb-3">{error}</div>
        <button onClick={() => router.push("/tools/poll")} className="text-caption underline">
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
          <div className="text-caption text-text-tertiary flex items-center gap-2">
            {st.status === "lobby"
              ? "대기실"
              : st.status === "ended"
                ? "종료됨"
                : `질문 ${st.current_index + 1} / ${st.total}`}
            <span className="inline-flex items-center gap-1">
              <Users size={12} /> {st.participant_count}명
            </span>
            <span
              className="inline-flex items-center gap-1"
              title={st.results_to_students ? "학생 기기에도 결과 표시" : "결과는 이 화면에만 표시"}
            >
              {st.results_to_students ? <Eye size={12} /> : <EyeOff size={12} />}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {st.status !== "ended" && (
            <span className="font-mono text-lg font-bold text-teal-700 tracking-[0.3em] bg-teal-50 border border-teal-200 rounded px-3 py-1">
              {st.pin}
            </span>
          )}
          <button
            onClick={() => openToolWindow(`/tools/poll/${sid}/host`)}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-border-default rounded text-caption text-text-secondary hover:bg-bg-secondary"
            title="새 창에서 열기 (프로젝터)"
          >
            <ExternalLink size={13} /> 새 창
          </button>
          {st.status !== "ended" && (
            <button
              onClick={() => { if (confirm("투표를 종료할까요?")) act("end"); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-border-default rounded text-caption text-text-secondary hover:bg-bg-secondary"
            >
              <Square size={13} /> 종료
            </button>
          )}
        </div>
      </div>

      {st.status === "lobby" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-border-default rounded-xl p-8 bg-bg-primary text-center">
            <div className="text-caption text-text-tertiary mb-2">참여 PIN</div>
            <div className="font-mono text-6xl font-extrabold tracking-[0.2em] text-teal-700 mb-5">
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
              onClick={() => act("start")}
              className="mt-6 inline-flex items-center gap-2 px-8 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-lg font-semibold"
            >
              <Play size={20} /> 시작
            </button>
          </div>
          <div className="border border-border-default rounded-xl p-8 bg-bg-primary flex flex-col items-center justify-center">
            <Users size={40} className="text-teal-600 mb-3" />
            <div className="text-5xl font-extrabold text-text-primary mb-1">
              {st.participant_count}
            </div>
            <div className="text-body text-text-secondary">명 입장</div>
            <div className="text-caption text-text-tertiary mt-3 text-center">
              입장 후에도 진행 중 언제든 참여할 수 있습니다
            </div>
          </div>
        </div>
      )}

      {st.status === "question" && st.current_question && (
        <div>
          <div className="border border-border-default rounded-2xl bg-bg-primary p-6 sm:p-8 mb-4">
            <div className="text-2xl sm:text-3xl font-bold text-center mb-6 whitespace-pre-wrap">
              {st.current_question.prompt}
            </div>
            {st.results && (
              <PollResultsView question={st.current_question} results={st.results} />
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-body text-text-secondary">
              응답{" "}
              <span className="font-bold text-teal-700">
                {st.results?.respondents ?? 0}
              </span>
              {" / "}{st.participant_count}명
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => act("goto", { index: st.current_index - 1 })}
                disabled={st.current_index <= 0}
                className="inline-flex items-center gap-1 px-4 py-2 border border-border-default rounded-lg text-body disabled:opacity-30 hover:bg-bg-secondary"
              >
                <ArrowLeft size={15} /> 이전
              </button>
              {st.current_index + 1 < st.total ? (
                <button
                  onClick={() => act("goto", { index: st.current_index + 1 })}
                  className="inline-flex items-center gap-1 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-body font-medium"
                >
                  다음 <ArrowRight size={15} />
                </button>
              ) : (
                <button
                  onClick={() => { if (confirm("투표를 종료할까요?")) act("end"); }}
                  className="inline-flex items-center gap-1 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-body font-medium"
                >
                  마치기 <Square size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {st.status === "ended" && (
        <div className="space-y-5">
          {(st.all_results || []).map((qr, i) => (
            <div key={qr.question.id || i} className="border border-border-default rounded-2xl bg-bg-primary p-6">
              <div className="text-lg font-bold mb-4 whitespace-pre-wrap">
                <span className="text-text-tertiary mr-2">{i + 1}.</span>
                {qr.question.prompt}
              </div>
              <PollResultsView question={qr.question} results={qr.results} />
            </div>
          ))}
          <div className="text-center">
            <button
              onClick={() => router.push("/tools/poll")}
              className="px-6 py-2.5 border border-border-default rounded-lg text-body hover:bg-bg-secondary"
            >
              목록으로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
