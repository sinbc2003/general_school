"use client";

/**
 * 라이브 퀴즈 — 교사용 홈.
 *
 * 본인 host 세션 목록 + "새 퀴즈":
 *  - 직접 만들기 (Kahoot식): 문제·보기·정답·이미지를 즉석 작성 → POST /sessions/direct
 *  - 코스웨어에서 가져오기: 기존 문제 세트 재사용 (자동채점 가능 문제만 출제)
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Gamepad2, Plus, X, Loader2, ChevronLeft, Play, Users, Clock,
  ImagePlus, Trash2, BookOpen, PencilLine,
} from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

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
const CHOICE_COLORS = ["bg-red-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500"];
const CHOICE_SHAPES = ["▲", "◆", "●", "■"];

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
            문제를 직접 만들거나 코스웨어 세트로 게임을 열면 학생들이 PIN으로 입장합니다
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
            "새 퀴즈"를 눌러 게임을 시작하세요.
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

// ─────────────────────────────────────────────────────────────────────────────
// 새 퀴즈 모달 — [직접 만들기 | 코스웨어에서] 탭
// ─────────────────────────────────────────────────────────────────────────────

interface DraftQuestion {
  content: string;
  choices: string[];   // 4칸 — 빈 칸은 제출 시 제외
  correct: number[];   // 원본 index (제출 시 빈 칸 제거 후 letter 재매핑)
  imageUrl?: string;
}

function emptyQuestion(): DraftQuestion {
  return { content: "", choices: ["", "", "", ""], correct: [] };
}

/** 인증 이미지 썸네일 (storage는 Bearer 필요 → blob) */
function AuthedThumb({ url, className }: { url: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("access_token");
        const r = await fetch(
          `${API_URL}${url.replace(/^\/storage\//, "/api/files/storage/")}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!r.ok) return;
        obj = URL.createObjectURL(await r.blob());
        if (!cancelled) setSrc(obj);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [url]);
  if (!src) return <div className={`${className} bg-bg-secondary animate-pulse rounded-lg`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} />;
}

function CreateQuizModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (sid: number) => void;
}) {
  const [tab, setTab] = useState<"direct" | "courseware">("direct");
  const [timePerQ, setTimePerQ] = useState(30);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 직접 만들기 ──
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  // ── 코스웨어 ──
  const [courses, setCourses] = useState<CourseGroup[] | null>(null);
  const [selected, setSelected] = useState<PsetItem | null>(null);

  useEffect(() => {
    if (tab !== "courseware" || courses !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ courses: CourseGroup[] }>(
          "/api/courseware/my-problem-sets",
        );
        if (!cancelled) {
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
  }, [tab, courses]);

  const patchQ = (i: number, patch: Partial<DraftQuestion>) => {
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };

  const uploadImage = async (i: number, f: File) => {
    setUploadingIdx(i);
    try {
      const res = await api.upload<{ url: string }>("/api/tools/quiz/upload-image", f);
      patchQ(i, { imageUrl: res.url });
    } catch (e: any) {
      alert(e?.detail || "이미지 업로드 실패");
    } finally {
      setUploadingIdx(null);
    }
  };

  const directValid =
    title.trim().length > 0 &&
    questions.length > 0 &&
    questions.every((q) => {
      const filled = q.choices.filter((c) => c.trim());
      const hasCorrect = q.correct.some((ci) => q.choices[ci]?.trim());
      return (q.content.trim() || q.imageUrl) && filled.length >= 2 && hasCorrect;
    });

  const createDirect = async () => {
    if (!directValid || creating) return;
    setCreating(true);
    setError(null);
    try {
      // 빈 보기 제거 후 정답 letter 재매핑
      const payload = questions.map((q) => {
        const kept: string[] = [];
        const remap = new Map<number, number>(); // 원본 idx → 새 idx
        q.choices.forEach((c, oi) => {
          if (c.trim()) {
            remap.set(oi, kept.length);
            kept.push(c.trim());
          }
        });
        const correct = q.correct
          .filter((oi) => remap.has(oi))
          .map((oi) => String.fromCharCode(65 + remap.get(oi)!));
        return {
          content: q.content.trim() || "(이미지 문제)",
          choices: kept,
          correct,
          image_url: q.imageUrl,
        };
      });
      const res = await api.post<{ id: number }>("/api/tools/quiz/sessions/direct", {
        title: title.trim(),
        questions: payload,
        settings: { time_per_question: timePerQ },
      });
      onCreated(res.id);
    } catch (e: any) {
      setError(e?.detail || "퀴즈를 만들 수 없습니다");
      setCreating(false);
    }
  };

  const createFromCourseware = async () => {
    if (!selected || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ id: number; skipped_problems: number }>(
        "/api/tools/quiz/sessions",
        { problem_set_id: selected.id, settings: { time_per_question: timePerQ } },
      );
      if (res.skipped_problems > 0) {
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
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium flex items-center gap-2">
            <Gamepad2 size={17} className="text-violet-600" /> 새 라이브 퀴즈
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>

        {/* 탭 */}
        <div className="flex gap-1 px-5 pt-3 border-b border-border-default">
          {([["direct", "직접 만들기", PencilLine], ["courseware", "코스웨어에서 가져오기", BookOpen]] as const).map(
            ([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-body border-b-2 -mb-px transition ${
                  tab === key
                    ? "border-violet-600 text-violet-700 font-medium"
                    : "border-transparent text-text-tertiary hover:text-text-primary"
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ),
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="text-caption text-status-error mb-3">{error}</div>}

          {tab === "direct" ? (
            <div className="space-y-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="퀴즈 제목*"
                autoFocus
                className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-violet-500"
              />
              {questions.map((q, i) => (
                <div key={i} className="border border-border-default rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-caption font-bold text-violet-700">문제 {i + 1}</span>
                    {questions.length > 1 && (
                      <button
                        onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                        className="p-1 text-text-tertiary hover:text-red-600 rounded"
                        title="문제 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={q.content}
                    onChange={(e) => patchQ(i, { content: e.target.value })}
                    rows={2}
                    placeholder="문제를 입력하세요 (LaTeX $...$ 지원)"
                    className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-violet-500 resize-y mb-2"
                  />
                  {/* 이미지 */}
                  {q.imageUrl ? (
                    <div className="relative inline-block mb-2">
                      <AuthedThumb url={q.imageUrl} className="max-h-32 rounded-lg" />
                      <button
                        onClick={() => patchQ(i, { imageUrl: undefined })}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-border-default rounded-lg text-caption text-text-secondary hover:bg-bg-secondary cursor-pointer mb-2">
                      {uploadingIdx === i
                        ? <Loader2 size={13} className="animate-spin" />
                        : <ImagePlus size={13} />}
                      이미지 추가
                      <input
                        type="file" accept="image/*" className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadImage(i, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {/* 보기 4개 — Kahoot 색·도형 + 정답 체크 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {q.choices.map((c, ci) => (
                      <div
                        key={ci}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${CHOICE_COLORS[ci]} ${
                          c.trim() ? "" : "opacity-50"
                        }`}
                      >
                        <span className="text-white text-[13px] flex-shrink-0">{CHOICE_SHAPES[ci]}</span>
                        <input
                          value={c}
                          onChange={(e) => patchQ(i, {
                            choices: q.choices.map((x, xi) => (xi === ci ? e.target.value : x)),
                          })}
                          placeholder={`보기 ${ci + 1}${ci >= 2 ? " (선택)" : ""}`}
                          className="flex-1 bg-transparent text-white placeholder:text-white/60 text-body outline-none min-w-0"
                        />
                        <label
                          className="flex items-center gap-1 text-[10px] text-white/90 cursor-pointer flex-shrink-0"
                          title="정답"
                        >
                          <input
                            type="checkbox"
                            checked={q.correct.includes(ci)}
                            onChange={(e) => patchQ(i, {
                              correct: e.target.checked
                                ? [...q.correct, ci]
                                : q.correct.filter((x) => x !== ci),
                            })}
                          />
                          정답
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}
                className="w-full py-2.5 border border-dashed border-violet-300 rounded-xl text-caption text-violet-700 hover:bg-violet-50 inline-flex items-center justify-center gap-1.5"
              >
                <Plus size={14} /> 문제 추가
              </button>
            </div>
          ) : (
            <div>
              {courses === null && !error && (
                <div className="flex items-center justify-center py-10 text-text-tertiary">
                  <Loader2 size={16} className="animate-spin mr-2" /> 문제 세트 불러오는 중...
                </div>
              )}
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
          )}
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
            onClick={tab === "direct" ? createDirect : createFromCourseware}
            disabled={creating || (tab === "direct" ? !directValid : !selected)}
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
