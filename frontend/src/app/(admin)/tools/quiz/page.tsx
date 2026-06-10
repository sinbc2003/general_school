"use client";

/**
 * 라이브 퀴즈 — 교사용 홈.
 *
 * 본인 host 세션 목록 + "새 퀴즈" (코스웨어 문제 세트 선택 → 세션 생성 → 진행 화면).
 * 문제 세트는 GET /api/courseware/my-problem-sets 재사용 (자동채점 가능 문제만 출제됨).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Gamepad2, Plus, X, Loader2, ChevronLeft, Play, Users, Clock,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface SessionItem {
  id: number;
  title: string;
  pin: string;
  status: string;
  problem_count: number;
  player_count: number;
  created_at: string | null;
  ended_at: string | null;
}

interface PsetItem {
  id: number;
  title: string;
  problem_count: number;
  status: string;
}

interface CourseGroup {
  course_id: number;
  course_name: string;
  is_active: boolean;
  sets: PsetItem[];
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  lobby: { text: "대기 중", cls: "bg-amber-100 text-amber-800" },
  question: { text: "진행 중", cls: "bg-emerald-100 text-emerald-800" },
  reveal: { text: "진행 중", cls: "bg-emerald-100 text-emerald-800" },
  ended: { text: "종료", cls: "bg-bg-secondary text-text-tertiary" },
};

const TIME_OPTIONS = [10, 20, 30, 60, 90, 120];

export default function QuizHomePage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: SessionItem[] }>("/api/tools/quiz/sessions");
      setSessions(res.items || []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-1"
          >
            <ChevronLeft size={14} /> 도구 모음
          </Link>
          <h1 className="text-title font-semibold flex items-center gap-2">
            <Gamepad2 size={22} className="text-violet-600" /> 라이브 퀴즈
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            문제 세트로 게임을 열면 학생들이 PIN으로 입장합니다 (객관식·단답·수치 자동채점 문제만 출제)
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-body font-medium"
        >
          <Plus size={16} /> 새 퀴즈
        </button>
      </div>

      {sessions === null && (
        <div className="flex items-center justify-center py-16 text-text-tertiary">
          <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      )}

      {sessions && sessions.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border-default rounded-xl">
          <Gamepad2 size={40} className="mx-auto mb-3 text-text-tertiary opacity-40" />
          <div className="text-body text-text-secondary">아직 만든 퀴즈가 없습니다.</div>
          <div className="text-caption text-text-tertiary mt-1">
            "새 퀴즈"를 눌러 문제 세트로 게임을 시작하세요.
          </div>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const badge = STATUS_LABEL[s.status] || STATUS_LABEL.ended;
            return (
              <li key={s.id}>
                <button
                  onClick={() => router.push(`/tools/quiz/${s.id}/host`)}
                  className="w-full text-left px-4 py-3 border border-border-default rounded-lg bg-bg-primary hover:border-violet-300 hover:shadow-sm transition flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-medium truncate">{s.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>
                        {badge.text}
                      </span>
                    </div>
                    <div className="text-caption text-text-tertiary mt-0.5">
                      {s.created_at ? new Date(s.created_at).toLocaleString("ko-KR") : ""}
                      {" · "}문제 {s.problem_count}개
                    </div>
                  </div>
                  {s.status !== "ended" && (
                    <span className="font-mono text-body font-bold text-violet-700 tracking-widest">
                      {s.pin}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-caption text-text-secondary">
                    <Users size={14} /> {s.player_count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showCreate && (
        <CreateQuizModal
          onClose={() => setShowCreate(false)}
          onCreated={(sid) => router.push(`/tools/quiz/${sid}/host`)}
        />
      )}
    </div>
  );
}

function CreateQuizModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (sid: number) => void;
}) {
  const [courses, setCourses] = useState<CourseGroup[] | null>(null);
  const [selected, setSelected] = useState<PsetItem | null>(null);
  const [timePerQ, setTimePerQ] = useState(30);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ courses: CourseGroup[] }>(
          "/api/courseware/my-problem-sets",
        );
        if (!cancelled) {
          // 문제 있는 세트만 노출
          const cs = (res.courses || [])
            .map((c) => ({ ...c, sets: c.sets.filter((p) => p.problem_count > 0) }))
            .filter((c) => c.sets.length > 0);
          setCourses(cs);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || "문제 세트를 불러올 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const create = async () => {
    if (!selected || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ id: number; skipped_problems: number }>(
        "/api/tools/quiz/sessions",
        { problem_set_id: selected.id, settings: { time_per_question: timePerQ } },
      );
      if (res.skipped_problems > 0) {
        // 주관식 등 자동채점 불가 문제는 제외됨 — 안내만 하고 진행
        alert(`자동채점이 불가한 문제 ${res.skipped_problems}개는 퀴즈에서 제외됩니다.`);
      }
      onCreated(res.id);
    } catch (e: any) {
      setError(e?.detail || "퀴즈를 만들 수 없습니다");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium flex items-center gap-2">
            <Gamepad2 size={17} className="text-violet-600" /> 새 라이브 퀴즈
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {courses === null && !error && (
            <div className="flex items-center justify-center py-10 text-text-tertiary">
              <Loader2 size={16} className="animate-spin mr-2" /> 문제 세트 불러오는 중...
            </div>
          )}
          {error && <div className="text-caption text-status-error mb-3">{error}</div>}
          {courses && courses.length === 0 && (
            <div className="text-center py-10 text-text-tertiary text-caption">
              사용할 문제 세트가 없습니다.
              <br />먼저 <Link href="/courseware" className="underline">코스웨어</Link>에서 문제 세트를 만들어주세요.
            </div>
          )}
          {courses && courses.map((c) => (
            <div key={c.course_id} className="mb-4">
              <div className="text-caption font-semibold text-text-secondary mb-1.5">
                {c.course_name}
              </div>
              <ul className="space-y-1.5">
                {c.sets.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(p)}
                      className={`w-full text-left px-3 py-2 border rounded flex items-center justify-between transition ${
                        selected?.id === p.id
                          ? "border-violet-500 bg-violet-50"
                          : "border-border-default hover:bg-bg-secondary"
                      }`}
                    >
                      <span className="text-body truncate">{p.title}</span>
                      <span className="text-caption text-text-tertiary flex-shrink-0 ml-2">
                        {p.problem_count}문제
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <footer className="px-5 py-3 border-t border-border-default flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-caption text-text-secondary">
            <Clock size={14} />
            문제당
            <select
              value={timePerQ}
              onChange={(e) => setTimePerQ(Number(e.target.value))}
              className="px-1.5 py-1 border border-border-default rounded text-caption bg-bg-primary"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}초</option>
              ))}
            </select>
          </div>
          <div className="flex-1" />
          <button
            onClick={create}
            disabled={!selected || creating}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            게임 열기
          </button>
        </footer>
      </div>
    </div>
  );
}
