"use client";

/**
 * 문제 세트 출제 모달 — 3가지 추가 방식 탭.
 *
 *  1. inline 직접 입력 (InlineProblemForm)
 *  2. JSONL 파일 업로드 (서버에서 검증 + dry-run 가능)
 *  3. 라이브러리에서 선택 (bank search)
 *
 * 메타(제목·마감·재응시·해설표시)는 공통.
 */

import { useEffect, useState } from "react";
import { X, Plus, Upload, Library, Trash2, Search, Bot } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { InlineProblemForm } from "./InlineProblemForm";
import type { ProblemInline, BankSearchItem } from "./types";

interface ModelItem {
  id: number;
  provider: string;
  model_id: string;
  display_name: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  active: boolean;
}

interface Props {
  cid: number;
  onClose: () => void;
  onCreated: (psid: number) => void;
}

type Mode = "inline" | "jsonl" | "bank";

const DEFAULT_PROBLEM: ProblemInline = {
  type: "short_answer",
  content: "",
  answer: "",
  answer_data: { grader_type: "exact", correct: "" },
  difficulty: "medium",
};

export function ProblemSetCreateModal({ cid, onClose, onCreated }: Props) {
  const toast = useToast();

  // 공통 메타
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [showSolutionAfterDue, setShowSolutionAfterDue] = useState(true);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [timeLimitMin, setTimeLimitMin] = useState<number | "">("");
  const [shuffleQuestions, setShuffleQuestions] = useState(false);

  // LLM 자동 채점 (학생 제출 시 background)
  const [llmGraderEnabled, setLlmGraderEnabled] = useState(false);
  const [llmGraderModelKey, setLlmGraderModelKey] = useState<string>("");  // "provider|model_id"
  const [llmGraderSamples, setLlmGraderSamples] = useState<number>(1);  // SC 횟수 (1/3/5)
  const [models, setModels] = useState<ModelItem[]>([]);

  useEffect(() => {
    api.get<{ items: ModelItem[] }>("/api/chatbot/models")
      .then((res) => setModels(res.items.filter((m) => m.active)))
      .catch(() => setModels([]));
  }, []);

  const [mode, setMode] = useState<Mode>("inline");
  const [saving, setSaving] = useState(false);

  // inline
  const [problems, setProblems] = useState<ProblemInline[]>([{ ...DEFAULT_PROBLEM }]);

  // jsonl / zip — 같은 input에서 받고 확장자로 endpoint 분기
  const [jsonlFile, setJsonlFile] = useState<File | null>(null);
  const [jsonlPreview, setJsonlPreview] = useState<{
    total: number; valid: number;
    errors: { line: number; message: string }[];
    imported_images?: number;
  } | null>(null);

  const isZipFile = (f: File | null) =>
    !!f && f.name.toLowerCase().endsWith(".zip");
  const uploadEndpoint = (cid: number, f: File | null) =>
    isZipFile(f)
      ? `/api/courseware/courses/${cid}/problems/import-zip`
      : `/api/courseware/courses/${cid}/problems/import-jsonl`;

  // bank
  const [bankQuery, setBankQuery] = useState("");
  const [bankSubject, setBankSubject] = useState("");
  const [bankDifficulty, setBankDifficulty] = useState("");
  const [bankItems, setBankItems] = useState<BankSearchItem[]>([]);
  const [bankSelected, setBankSelected] = useState<Set<number>>(new Set());
  const [bankLoading, setBankLoading] = useState(false);

  const addProblem = () =>
    setProblems((prev) => [...prev, { ...DEFAULT_PROBLEM }]);

  const updateProblem = (i: number, next: ProblemInline) =>
    setProblems((prev) => prev.map((p, idx) => (idx === i ? next : p)));

  const removeProblem = (i: number) =>
    setProblems((prev) => prev.filter((_, idx) => idx !== i));

  const runJsonlPreview = async () => {
    if (!jsonlFile) {
      toast.show("파일을 선택하세요 (.jsonl 또는 .zip)", "error");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", jsonlFile);
      const ep = uploadEndpoint(cid, jsonlFile);
      const res = await api.fetch<{
        total: number; valid: number;
        errors: { line: number; message: string }[];
        imported_images?: number;
      }>(
        `${ep}?dry_run=true&create_set=false`,
        { method: "POST", body: fd },
      );
      setJsonlPreview(res);
    } catch (e: any) {
      toast.show(e?.detail || "검증 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  const searchBank = async () => {
    setBankLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("page_size", "30");
      if (bankQuery) params.set("search", bankQuery);
      if (bankSubject) params.set("subject", bankSubject);
      if (bankDifficulty) params.set("difficulty", bankDifficulty);
      const res = await api.get<{ items: BankSearchItem[] }>(
        `/api/courseware/problems-bank/search?${params.toString()}`,
      );
      setBankItems(res.items);
    } catch (e: any) {
      toast.show(e?.detail || "검색 실패", "error");
    } finally {
      setBankLoading(false);
    }
  };

  const toggleBankItem = (id: number) => {
    setBankSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commonBody = () => {
    const settings: Record<string, any> = {};
    if (shuffleQuestions) settings.shuffle_questions = true;
    if (llmGraderEnabled) {
      settings.llm_grader_enabled = true;
      if (llmGraderModelKey) {
        const [provider, model_id] = llmGraderModelKey.split("|");
        if (provider && model_id) {
          settings.llm_grader_provider = provider;
          settings.llm_grader_model = model_id;
        }
      }
      if (llmGraderSamples > 1) {
        settings.llm_grader_samples = llmGraderSamples;
      }
    }
    return {
      title,
      description: description || null,
      status,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      max_attempts: maxAttempts,
      show_solution_after_due: showSolutionAfterDue,
      time_limit_seconds:
        timeLimitMin === "" || timeLimitMin <= 0 ? null : Math.round(timeLimitMin * 60),
      settings: Object.keys(settings).length ? settings : null,
    };
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.show("제목을 입력하세요", "error");
      return;
    }
    setSaving(true);
    try {
      let psid: number | null = null;

      if (mode === "inline") {
        const validProblems = problems.filter((p) => p.content.trim());
        if (validProblems.length === 0) {
          toast.show("문제를 1개 이상 입력하세요", "error");
          setSaving(false);
          return;
        }
        const body = {
          ...commonBody(),
          problems: validProblems,
        };
        const created = await api.post<{ id: number }>(
          `/api/courseware/courses/${cid}/problem-sets`,
          body,
        );
        psid = created.id;
      } else if (mode === "jsonl") {
        if (!jsonlFile) {
          toast.show("파일을 선택하세요 (.jsonl 또는 .zip)", "error");
          setSaving(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", jsonlFile);
        const ep = uploadEndpoint(cid, jsonlFile);
        const url = new URL(ep, "http://x");
        url.searchParams.set("dry_run", "false");
        url.searchParams.set("create_set", "true");
        url.searchParams.set("set_title", title);
        const res = await api.fetch<{
          problem_set_id: number | null; valid: number; errors: any[];
          imported_images?: number;
        }>(url.pathname + url.search, { method: "POST", body: fd });
        psid = res.problem_set_id;
        if (!psid) {
          toast.show(`import 실패 — 유효 문제 ${res.valid}건, 오류 ${res.errors.length}건`, "error");
          setSaving(false);
          return;
        }
        if (res.imported_images) {
          toast.show(`이미지 ${res.imported_images}장 저장됨`, "success");
        }
      } else {
        // bank
        if (bankSelected.size === 0) {
          toast.show("문제를 1개 이상 선택하세요", "error");
          setSaving(false);
          return;
        }
        const body = {
          ...commonBody(),
          problem_ids: Array.from(bankSelected),
        };
        const created = await api.post<{ id: number }>(
          `/api/courseware/courses/${cid}/problem-sets/from-bank`,
          body,
        );
        psid = created.id;
      }
      if (psid) {
        toast.show("문제 세트 생성됨", "success");
        onCreated(psid);
      }
    } catch (e: any) {
      toast.show(e?.detail || "생성 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-h3">문제 세트 출제</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 메타 */}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-caption col-span-2">
              <div className="text-text-secondary mb-1">제목 *</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 1단원 형성평가"
                className="w-full px-2 py-1.5 border border-border-default rounded text-body"
              />
            </label>
            <label className="text-caption col-span-2">
              <div className="text-text-secondary mb-1">설명 (선택)</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-2 py-1.5 border border-border-default rounded text-body"
              />
            </label>
            <label className="text-caption">
              <div className="text-text-secondary mb-1">마감 (선택)</div>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2 py-1.5 border border-border-default rounded text-body"
              />
            </label>
            <label className="text-caption">
              <div className="text-text-secondary mb-1">재응시 횟수</div>
              <input
                type="number"
                min={1}
                max={99}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(parseInt(e.target.value || "1"))}
                className="w-full px-2 py-1.5 border border-border-default rounded text-body"
              />
            </label>
            <label className="flex items-center gap-1 text-caption">
              <input
                type="checkbox"
                checked={showSolutionAfterDue}
                onChange={(e) => setShowSolutionAfterDue(e.target.checked)}
              />
              마감 후 정답·해설 공개
            </label>
            <label className="text-caption">
              <div className="text-text-secondary mb-1">상태</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-2 py-1.5 border border-border-default rounded text-body"
              >
                <option value="draft">초안 (학생에게 안 보임)</option>
                <option value="published">게시 (학생 풀이 가능)</option>
              </select>
            </label>
            <label className="text-caption">
              <div className="text-text-secondary mb-1">시간 제한 (분, 선택)</div>
              <input
                type="number"
                min={1}
                value={timeLimitMin}
                onChange={(e) =>
                  setTimeLimitMin(e.target.value === "" ? "" : parseInt(e.target.value))
                }
                placeholder="비워두면 무제한"
                className="w-full px-2 py-1.5 border border-border-default rounded text-body"
              />
            </label>
            <label className="flex items-center gap-1 text-caption">
              <input
                type="checkbox"
                checked={shuffleQuestions}
                onChange={(e) => setShuffleQuestions(e.target.checked)}
              />
              문제 순서 random (학생간 컨닝 방지)
            </label>
          </div>

          {/* LLM 자동 채점 — essay/주관식 문제용 */}
          <div className="bg-cream-50 border border-cream-300 rounded p-3 space-y-2">
            <label className="flex items-center gap-1.5 text-caption">
              <input
                type="checkbox"
                checked={llmGraderEnabled}
                onChange={(e) => setLlmGraderEnabled(e.target.checked)}
              />
              <Bot size={14} className="text-text-secondary" />
              <span className="font-semibold">AI 자동 채점 — essay/주관식</span>
              <span className="text-text-tertiary text-[11px]">
                (객관식·단답·수치는 자동채점 그대로)
              </span>
            </label>
            {llmGraderEnabled && (
              <div className="pl-6 space-y-2">
                <div className="text-[11px] text-text-tertiary">
                  학생 제출 즉시 background로 AI 채점 → 교사가 결과 검토·override 가능
                </div>
                <select
                  value={llmGraderModelKey}
                  onChange={(e) => setLlmGraderModelKey(e.target.value)}
                  className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                >
                  <option value="">시스템 기본 (학생용 모델)</option>
                  {models.map((m) => (
                    <option key={`${m.provider}|${m.model_id}`} value={`${m.provider}|${m.model_id}`}>
                      {m.provider} · {m.display_name} (in ${m.input_per_1m_usd}/M, out ${m.output_per_1m_usd}/M)
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2 text-caption">
                  <span className="text-text-tertiary">신뢰도</span>
                  <select
                    value={llmGraderSamples}
                    onChange={(e) => setLlmGraderSamples(parseInt(e.target.value))}
                    className="px-2 py-1 border border-border-default rounded text-body"
                  >
                    <option value={1}>1회 호출 (default — 비용 최저)</option>
                    <option value={3}>3회 자체일치 (Self-Consistency, 비용 3배, 정확도 +)</option>
                    <option value={5}>5회 자체일치 (비용 5배, 정확도 최고)</option>
                  </select>
                </div>
                {llmGraderSamples > 1 && (
                  <div className="text-[11px] text-text-tertiary">
                    같은 답안을 {llmGraderSamples}번 채점해 평균. 점수 편차(σ) 큰 답안은
                    "검토 필요" 마크 → 교사 우선 확인.
                  </div>
                )}
                {models.length === 0 && (
                  <div className="text-[11px] text-amber-700">
                    활성 모델이 없습니다. /system/llm/providers에서 API 키 등록 + 활성화 필요.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 추가 방식 탭 */}
          <div className="border-b border-border-default flex gap-1">
            {[
              { id: "inline" as const, label: "직접 입력", icon: Plus },
              { id: "jsonl" as const, label: "JSONL 업로드", icon: Upload },
              { id: "bank" as const, label: "라이브러리", icon: Library },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = mode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMode(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-caption border-b-2 transition ${
                    isActive
                      ? "border-accent-default text-accent-default font-semibold"
                      : "border-transparent text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* inline */}
          {mode === "inline" && (
            <div className="space-y-3">
              {problems.map((p, i) => (
                <InlineProblemForm
                  key={i}
                  index={i}
                  value={p}
                  onChange={(next) => updateProblem(i, next)}
                  onRemove={() => removeProblem(i)}
                />
              ))}
              <button
                type="button"
                onClick={addProblem}
                className="w-full py-2 border border-dashed border-border-default rounded text-caption text-text-secondary hover:bg-bg-secondary"
              >
                + 문제 추가
              </button>
            </div>
          )}

          {/* JSONL or ZIP */}
          {mode === "jsonl" && (
            <div className="space-y-3">
              <div className="bg-cream-100 border border-cream-300 rounded p-3 text-caption text-text-secondary space-y-2">
                <div>
                  <div className="font-semibold mb-1">JSONL 형식 (한 줄 = 한 문제)</div>
                  <pre className="bg-bg-primary border border-border-default rounded p-2 text-[11px] overflow-x-auto">
{`{"type": "multiple_choice", "content": "1+1은?",
 "answer_data": {"grader_type": "choices", "correct": ["B"],
                 "choices": ["A. 1", "B. 2", "C. 3"]},
 "answer": "2", "difficulty": "easy", "subject": "수학", "tags": ["기초"]}
{"type": "numeric", "content": "원주율 소수 둘째자리까지",
 "answer_data": {"grader_type": "numeric", "value": 3.14, "tolerance": 0.01}}`}
                  </pre>
                </div>
                <div>
                  <div className="font-semibold mb-1">이미지 포함 → ZIP 패키지</div>
                  <pre className="bg-bg-primary border border-border-default rounded p-2 text-[11px] overflow-x-auto">
{`math.zip
 ├ problems.jsonl   (content 안에 ![](images/fig1.png))
 └ images/
    ├ fig1.png
    └ fig2.jpg`}
                  </pre>
                  <div className="text-[11px] text-text-tertiary mt-1">
                    ZIP 안 .jsonl 1개 + images/ 폴더. 이미지는 storage에 자동 저장 + URL 자동 치환.
                  </div>
                </div>
              </div>
              <input
                type="file"
                accept=".jsonl,.json,.zip"
                onChange={(e) => {
                  setJsonlFile(e.target.files?.[0] || null);
                  setJsonlPreview(null);
                }}
                className="text-body"
              />
              {jsonlFile && (
                <div className="flex items-center gap-2">
                  <span className="text-caption text-text-tertiary">
                    {jsonlFile.name} · {(jsonlFile.size / 1024).toFixed(1)} KB · {isZipFile(jsonlFile) ? "ZIP (이미지 포함)" : "JSONL"}
                  </span>
                  <button
                    type="button"
                    onClick={runJsonlPreview}
                    disabled={saving}
                    className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
                  >
                    {saving ? "검증 중..." : "검증 실행 (dry-run)"}
                  </button>
                </div>
              )}
              {jsonlPreview && (
                <div className={`p-3 rounded text-caption ${
                  jsonlPreview.errors.length === 0
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                    : "bg-amber-50 border border-amber-200 text-amber-900"
                }`}>
                  <div className="font-semibold mb-1">
                    총 {jsonlPreview.total}줄 · 유효 {jsonlPreview.valid}개 · 오류 {jsonlPreview.errors.length}건
                    {typeof jsonlPreview.imported_images === "number" && (
                      <> · 이미지 매칭 {jsonlPreview.imported_images}장</>
                    )}
                  </div>
                  {jsonlPreview.errors.length > 0 && (
                    <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                      {jsonlPreview.errors.slice(0, 20).map((e, i) => (
                        <li key={i} className="text-[11px]">
                          <span className="font-mono">L{e.line}</span>: {e.message}
                        </li>
                      ))}
                      {jsonlPreview.errors.length > 20 && (
                        <li className="text-[11px] italic">…+{jsonlPreview.errors.length - 20}건 더</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* bank */}
          {mode === "bank" && (
            <div className="space-y-3">
              <div className="flex gap-2 items-end">
                <input
                  value={bankQuery}
                  onChange={(e) => setBankQuery(e.target.value)}
                  placeholder="본문 검색"
                  className="flex-1 px-2 py-1.5 border border-border-default rounded text-body"
                  onKeyDown={(e) => e.key === "Enter" && searchBank()}
                />
                <input
                  value={bankSubject}
                  onChange={(e) => setBankSubject(e.target.value)}
                  placeholder="과목"
                  className="w-24 px-2 py-1.5 border border-border-default rounded text-body"
                />
                <select
                  value={bankDifficulty}
                  onChange={(e) => setBankDifficulty(e.target.value)}
                  className="px-2 py-1.5 border border-border-default rounded text-body"
                >
                  <option value="">전체</option>
                  <option value="easy">쉬움</option>
                  <option value="medium">보통</option>
                  <option value="hard">어려움</option>
                  <option value="olympiad">올림피아드</option>
                </select>
                <button
                  type="button"
                  onClick={searchBank}
                  disabled={bankLoading}
                  className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50 flex items-center gap-1"
                >
                  <Search size={12} /> {bankLoading ? "..." : "검색"}
                </button>
              </div>
              <div className="text-caption text-text-tertiary">
                선택됨: {bankSelected.size}개
              </div>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {bankItems.length === 0 ? (
                  <div className="text-caption text-text-tertiary text-center py-8">
                    검색 결과 없음
                  </div>
                ) : (
                  bankItems.map((p) => {
                    const selected = bankSelected.has(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-start gap-2 p-2 border rounded cursor-pointer ${
                          selected ? "border-accent-default bg-cream-50" : "border-border-default hover:bg-bg-secondary"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleBankItem(p.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-caption text-text-tertiary mb-0.5">
                            <span className="px-1.5 py-0.5 bg-bg-secondary rounded text-[10px]">
                              {p.question_type}
                            </span>
                            <span>{p.subject}</span>
                            <span>·</span>
                            <span>{p.difficulty}</span>
                            {p.grader_type && (
                              <>
                                <span>·</span>
                                <span className="font-mono">{p.grader_type}</span>
                              </>
                            )}
                          </div>
                          <div className="text-body line-clamp-2">{p.content_preview}</div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-caption bg-accent-default text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "저장 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
