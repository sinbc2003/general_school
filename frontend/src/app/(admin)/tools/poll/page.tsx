"use client";

/**
 * 실시간 투표·워드클라우드 (Mentimeter형) — 교사 목록 + 빌더.
 *
 * - 본인 투표 목록 (질문 미리보기, 진행 중 PIN 배지)
 * - 빌더 모달: 객관식 투표(보기·복수응답) / 워드클라우드(1인당 단어 수) 질문 여러 개
 * - "시작" → 세션 생성(학생 결과 공개 옵션) → /tools/poll/{sid}/host
 * - ?edit={id} — 드라이브에서 열면 편집 모달 자동 오픈
 * - 최근 세션 목록 (진행 중 이어가기 / 종료 결과 보기)
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3, Cloud, ExternalLink, Loader2, Pencil, Play, Plus,
  Trash2, X, CheckSquare,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { openToolWindow } from "@/lib/open-tool-window";

interface PollQuestionDraft {
  id?: string;
  type: "choice" | "wordcloud";
  prompt: string;
  options: string[];
  multi: boolean;
  max_words: number;
}

interface PollItem {
  id: number;
  title: string;
  description: string | null;
  questions: any[];
  question_count: number;
  active_pin: string | null;
  updated_at: string | null;
}

interface SessionItem {
  id: number;
  title: string;
  pin: string;
  status: string;
  question_count: number;
  participant_count: number;
  created_at: string | null;
  ended_at: string | null;
}

const EMPTY_CHOICE: PollQuestionDraft = {
  type: "choice", prompt: "", options: ["", ""], multi: false, max_words: 3,
};

export default function PollListPage() {
  // useSearchParams는 Suspense 경계 필요 (Next 빌드 요구)
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    }>
      <PollListInner />
    </Suspense>
  );
}

function PollListInner() {
  const router = useRouter();
  const search = useSearchParams();

  const [polls, setPolls] = useState<PollItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PollItem | null>(null);
  const [startTarget, setStartTarget] = useState<PollItem | null>(null);
  // 마지막으로 처리한 ?edit= 값 — 모달 닫으면 초기화 (같은 투표 재진입 허용)
  const lastHandledEditId = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        api.get<{ items: PollItem[] }>("/api/tools/poll"),
        api.get<{ items: SessionItem[] }>("/api/tools/poll/sessions"),
      ]);
      setPolls(p.items);
      setSessions(s.items);
    } catch { /* 다음 갱신에서 */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 드라이브에서 ?edit={id}로 진입 — 목록 로드 후 자동 오픈
  useEffect(() => {
    const editId = search.get("edit");
    if (!editId || editId === lastHandledEditId.current || loading) return;
    const target = polls.find((p) => p.id === Number(editId));
    if (target) {
      lastHandledEditId.current = editId;
      setEditTarget(target);
      setEditorOpen(true);
      window.history.replaceState(null, "", "/tools/poll");
    }
  }, [search, polls, loading]);

  const removePoll = async (p: PollItem) => {
    if (!confirm(`"${p.title}"을(를) 휴지통으로 이동할까요?\n(드라이브 휴지통에서 30일 내 복구 가능)`)) return;
    try {
      await api.delete(`/api/tools/poll/${p.id}`);
      await fetchAll();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const running = sessions.filter((s) => s.status !== "ended");
  const past = sessions.filter((s) => s.status === "ended").slice(0, 10);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title font-semibold flex items-center gap-2">
            <BarChart3 size={20} className="text-teal-700" /> 실시간 투표
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            투표·워드클라우드를 만들고 PIN으로 모으기 — 결과가 실시간 그래프로
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openToolWindow("/tools/poll")}
            className="inline-flex items-center gap-1 px-3 py-2 border border-border-default rounded-lg text-caption text-text-secondary hover:bg-bg-secondary"
          >
            <ExternalLink size={13} /> 새 창
          </button>
          <button
            onClick={() => { setEditTarget(null); setEditorOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-body font-medium"
          >
            <Plus size={16} /> 새 투표
          </button>
        </div>
      </header>

      {/* 진행 중 세션 */}
      {running.length > 0 && (
        <section className="mb-6">
          <h2 className="text-caption font-semibold text-text-secondary mb-2">진행 중</h2>
          <div className="space-y-2">
            {running.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/tools/poll/${s.id}/host`)}
                className="w-full flex items-center gap-3 border border-teal-300 bg-teal-50 rounded-lg px-4 py-3 hover:bg-teal-100 text-left"
              >
                <span className="font-mono text-lg font-bold text-teal-700 tracking-widest">{s.pin}</span>
                <span className="text-body font-medium flex-1 truncate">{s.title}</span>
                <span className="text-caption text-text-tertiary">{s.participant_count}명 참여</span>
                <span className="text-caption text-teal-700 font-medium">이어가기 →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 투표 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-text-tertiary">
          <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      ) : polls.length === 0 ? (
        <div className="border border-dashed border-border-default rounded-xl py-16 text-center">
          <BarChart3 size={32} className="mx-auto text-text-tertiary mb-3" />
          <div className="text-body text-text-secondary mb-1">아직 만든 투표가 없습니다</div>
          <div className="text-caption text-text-tertiary">
            "새 투표"로 객관식 투표·워드클라우드 질문을 만들어 보세요
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {polls.map((p) => (
            <div
              key={p.id}
              className="border border-border-default rounded-xl bg-bg-primary p-4 flex flex-col hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-body font-semibold leading-snug flex-1">{p.title}</div>
                {p.active_pin && (
                  <span className="font-mono text-caption font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                    {p.active_pin}
                  </span>
                )}
              </div>
              <div className="text-caption text-text-tertiary mb-3 flex items-center gap-2">
                <span>질문 {p.question_count}개</span>
                <span className="flex items-center gap-1">
                  {p.questions.some((q: any) => q.type === "choice") && <BarChart3 size={11} />}
                  {p.questions.some((q: any) => q.type === "wordcloud") && <Cloud size={11} />}
                </span>
              </div>
              <div className="text-caption text-text-secondary line-clamp-2 flex-1 mb-3">
                {p.questions.map((q: any) => q.prompt).join(" · ")}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setStartTarget(p)}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-caption font-medium"
                >
                  <Play size={13} /> 시작
                </button>
                <button
                  onClick={() => { setEditTarget(p); setEditorOpen(true); }}
                  className="p-1.5 border border-border-default rounded-lg text-text-secondary hover:bg-bg-secondary"
                  title="편집"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => removePoll(p)}
                  className="p-1.5 border border-border-default rounded-lg text-text-secondary hover:bg-red-50 hover:text-red-600"
                  title="휴지통으로"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 지난 세션 */}
      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="text-caption font-semibold text-text-secondary mb-2">지난 세션</h2>
          <div className="space-y-1.5">
            {past.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/tools/poll/${s.id}/host`)}
                className="w-full flex items-center gap-3 border border-border-default rounded-lg px-4 py-2.5 hover:bg-bg-secondary text-left"
              >
                <span className="text-body flex-1 truncate">{s.title}</span>
                <span className="text-caption text-text-tertiary">{s.participant_count}명</span>
                <span className="text-caption text-text-tertiary">
                  {s.created_at ? new Date(s.created_at).toLocaleDateString("ko-KR") : ""}
                </span>
                <span className="text-caption text-teal-700">결과 보기</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {editorOpen && (
        <PollEditorModal
          target={editTarget}
          onClose={() => { setEditorOpen(false); lastHandledEditId.current = null; }}
          onSaved={async () => {
            setEditorOpen(false);
            lastHandledEditId.current = null;
            await fetchAll();
          }}
        />
      )}
      {startTarget && (
        <StartSessionModal
          poll={startTarget}
          onClose={() => setStartTarget(null)}
          onStarted={(sid) => router.push(`/tools/poll/${sid}/host`)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PollEditorModal({
  target, onClose, onSaved,
}: {
  target: PollItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(target?.title || "");
  const [questions, setQuestions] = useState<PollQuestionDraft[]>(() => {
    if (target?.questions?.length) {
      return target.questions.map((q: any) => ({
        id: q.id,
        type: q.type === "wordcloud" ? "wordcloud" : "choice",
        prompt: q.prompt || "",
        options: q.type === "choice" ? [...(q.options || ["", ""])] : ["", ""],
        multi: !!q.multi,
        max_words: q.max_words || 3,
      }));
    }
    return [{ ...EMPTY_CHOICE, options: ["", ""] }];
  });
  const [saving, setSaving] = useState(false);

  const patchQ = (i: number, patch: Partial<PollQuestionDraft>) => {
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };

  const save = async () => {
    if (!title.trim()) { alert("제목을 입력하세요"); return; }
    const payload = questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt.trim(),
      options: q.type === "choice" ? q.options.filter((o) => o.trim()) : [],
      multi: q.multi,
      max_words: q.max_words,
    }));
    for (let i = 0; i < payload.length; i++) {
      if (!payload[i].prompt) { alert(`${i + 1}번 질문 내용을 입력하세요`); return; }
      if (payload[i].type === "choice" && payload[i].options.length < 2) {
        alert(`${i + 1}번 질문: 보기를 2개 이상 입력하세요`); return;
      }
    }
    setSaving(true);
    try {
      if (target) {
        await api.put(`/api/tools/poll/${target.id}`, { title: title.trim(), questions: payload });
      } else {
        await api.post("/api/tools/poll", { title: title.trim(), questions: payload });
      }
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-default">
          <h2 className="text-body font-semibold">{target ? "투표 편집" : "새 투표"}</h2>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="투표 제목 (예: 오늘 수업 피드백)"
            className="w-full border border-border-default rounded-lg px-3 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />

          {questions.map((q, i) => (
            <div key={i} className="border border-border-default rounded-xl p-4 bg-bg-secondary/40">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-caption font-bold text-text-tertiary">{i + 1}</span>
                <div className="flex rounded-lg border border-border-default overflow-hidden">
                  <button
                    onClick={() => patchQ(i, { type: "choice" })}
                    className={`px-3 py-1.5 text-caption font-medium inline-flex items-center gap-1 ${
                      q.type === "choice" ? "bg-teal-600 text-white" : "bg-bg-primary text-text-secondary"
                    }`}
                  >
                    <BarChart3 size={12} /> 객관식 투표
                  </button>
                  <button
                    onClick={() => patchQ(i, { type: "wordcloud" })}
                    className={`px-3 py-1.5 text-caption font-medium inline-flex items-center gap-1 ${
                      q.type === "wordcloud" ? "bg-teal-600 text-white" : "bg-bg-primary text-text-secondary"
                    }`}
                  >
                    <Cloud size={12} /> 워드클라우드
                  </button>
                </div>
                <div className="flex-1" />
                {questions.length > 1 && (
                  <button
                    onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                    className="p-1 text-text-tertiary hover:text-red-600"
                    title="질문 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <input
                value={q.prompt}
                onChange={(e) => patchQ(i, { prompt: e.target.value })}
                placeholder={q.type === "choice" ? "질문 (예: 오늘 수업 어땠나요?)" : "질문 (예: 떠오르는 단어는?)"}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-body mb-3 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              />

              {q.type === "choice" ? (
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <span className="w-6 text-caption font-mono text-text-tertiary text-center">
                        {String.fromCharCode(65 + oi)}
                      </span>
                      <input
                        value={opt}
                        onChange={(e) => {
                          const next = [...q.options];
                          next[oi] = e.target.value;
                          patchQ(i, { options: next });
                        }}
                        placeholder={`보기 ${oi + 1}`}
                        className="flex-1 border border-border-default rounded-lg px-3 py-1.5 text-body focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                      />
                      {q.options.length > 2 && (
                        <button
                          onClick={() => patchQ(i, { options: q.options.filter((_, j) => j !== oi) })}
                          className="p-1 text-text-tertiary hover:text-red-600"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1">
                    {q.options.length < 10 ? (
                      <button
                        onClick={() => patchQ(i, { options: [...q.options, ""] })}
                        className="text-caption text-teal-700 hover:underline inline-flex items-center gap-1"
                      >
                        <Plus size={12} /> 보기 추가
                      </button>
                    ) : <span />}
                    <label className="inline-flex items-center gap-1.5 text-caption text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={q.multi}
                        onChange={(e) => patchQ(i, { multi: e.target.checked })}
                        className="accent-teal-600"
                      />
                      <CheckSquare size={12} /> 복수 응답 허용
                    </label>
                  </div>
                </div>
              ) : (
                <label className="inline-flex items-center gap-2 text-caption text-text-secondary">
                  1인당 단어
                  <select
                    value={q.max_words}
                    onChange={(e) => patchQ(i, { max_words: Number(e.target.value) })}
                    className="border border-border-default rounded px-2 py-1 text-caption bg-bg-primary"
                  >
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}개</option>)}
                  </select>
                </label>
              )}
            </div>
          ))}

          {questions.length < 50 && (
            <button
              onClick={() => setQuestions((qs) => [...qs, { ...EMPTY_CHOICE, options: ["", ""] }])}
              className="w-full border border-dashed border-border-default rounded-xl py-3 text-caption text-text-secondary hover:bg-bg-secondary inline-flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> 질문 추가
            </button>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-border-default flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-default rounded-lg text-body text-text-secondary hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-body font-medium"
          >
            {saving ? "저장 중..." : target ? "저장" : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StartSessionModal({
  poll, onClose, onStarted,
}: {
  poll: PollItem;
  onClose: () => void;
  onStarted: (sid: number) => void;
}) {
  const [resultsToStudents, setResultsToStudents] = useState(false);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const res = await api.post<{ id: number }>(
        `/api/tools/poll/${poll.id}/sessions`,
        { settings: { results_to_students: resultsToStudents } },
      );
      onStarted(res.id);
    } catch (e: any) {
      alert(e?.detail || "세션 생성 실패");
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-xl shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-body font-semibold mb-1">"{poll.title}" 시작</h2>
        <p className="text-caption text-text-tertiary mb-4">
          PIN이 발급되고 학생들이 입장할 수 있게 됩니다.
        </p>
        <label className="flex items-start gap-2 text-caption text-text-secondary mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={resultsToStudents}
            onChange={(e) => setResultsToStudents(e.target.checked)}
            className="accent-teal-600 mt-0.5"
          />
          <span>
            학생 기기에도 결과 보여주기
            <span className="block text-text-tertiary">
              끄면 결과는 교사(발표) 화면에만 표시됩니다
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-default rounded-lg text-body text-text-secondary hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            onClick={start}
            disabled={starting}
            className="inline-flex items-center gap-1.5 px-5 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-body font-medium"
          >
            <Play size={15} /> {starting ? "여는 중..." : "시작"}
          </button>
        </div>
      </div>
    </div>
  );
}
