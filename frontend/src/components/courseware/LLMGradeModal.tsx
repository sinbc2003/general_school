"use client";

/**
 * 교사 trigger LLM 일괄 채점 모달.
 *
 *  - provider/model 선택 (시스템 default 가능)
 *  - dry-run cost 미리보기
 *  - force 토글 (이미 채점된 것도 덮어쓰기)
 *  - 실행 → 동기 채점 (1~3분) → 결과 알림 후 페이지 reload
 */

import { useEffect, useState } from "react";
import { X, Bot, DollarSign, Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";

interface ModelItem {
  id: number;
  provider: string;
  model_id: string;
  display_name: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  active: boolean;
}

interface PreviewResp {
  eligible_attempts: number;
  provider: string | null;
  model_id: string | null;
  model_label: string | null;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  estimated_cost_usd: number;
}

interface GradeResultResp {
  total: number;
  graded: number;
  failed: number;
  total_cost_usd: number;
  errors: { attempt_id: number | null; message: string }[];
}

interface Props {
  psid: number;
  onClose: () => void;
  onDone: () => void;
}

export function LLMGradeModal({ psid, onClose, onDone }: Props) {
  const toast = useToast();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [modelKey, setModelKey] = useState<string>("");
  const [force, setForce] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GradeResultResp | null>(null);

  useEffect(() => {
    api.get<{ items: ModelItem[] }>("/api/chatbot/models")
      .then((res) => setModels(res.items.filter((m) => m.active)))
      .catch(() => setModels([]));
  }, []);

  const fetchPreview = async (mKey: string, f: boolean) => {
    setPreviewing(true);
    try {
      const params = new URLSearchParams();
      if (mKey) {
        const [p, m] = mKey.split("|");
        if (p) params.set("provider", p);
        if (m) params.set("model_id", m);
      }
      params.set("only_ungraded", String(!f));
      params.set("force", String(f));
      const res = await api.get<PreviewResp>(
        `/api/courseware/problem-sets/${psid}/llm-grade/preview?${params.toString()}`,
      );
      setPreview(res);
    } catch (e: any) {
      toast.show(e?.detail || "미리보기 실패", "error");
    } finally {
      setPreviewing(false);
    }
  };

  // 모달 열릴 때 + 옵션 변경 시 자동 preview
  useEffect(() => {
    fetchPreview(modelKey, force);
  }, [modelKey, force]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = async () => {
    if (!preview || preview.eligible_attempts === 0) {
      toast.show("채점할 attempt가 없습니다", "error");
      return;
    }
    if (preview.estimated_cost_usd > 1.0) {
      if (!confirm(`예상 비용 $${preview.estimated_cost_usd.toFixed(4)} — 실행할까요?`)) return;
    }
    setRunning(true);
    try {
      const [provider, model_id] = modelKey ? modelKey.split("|") : ["", ""];
      const res = await api.post<GradeResultResp>(
        `/api/courseware/problem-sets/${psid}/llm-grade`,
        {
          provider: provider || null,
          model_id: model_id || null,
          only_ungraded: !force,
          force,
        },
      );
      setResult(res);
      toast.show(
        `채점 완료 — ${res.graded}/${res.total} 성공, ` +
          `비용 $${res.total_cost_usd.toFixed(4)}`,
        "success",
      );
    } catch (e: any) {
      toast.show(e?.detail || "채점 실패", "error");
    } finally {
      setRunning(false);
    }
  };

  const handleClose = () => {
    if (result) onDone();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-h3 flex items-center gap-2">
            <Bot size={18} className="text-text-secondary" /> AI 일괄 채점
          </h2>
          <button type="button" onClick={handleClose} className="text-text-tertiary hover:text-text-primary p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!result && (
            <>
              <div>
                <label className="text-caption block mb-1">
                  <span className="text-text-secondary font-semibold">사용할 모델</span>
                </label>
                <select
                  value={modelKey}
                  onChange={(e) => setModelKey(e.target.value)}
                  className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                >
                  <option value="">시스템 기본 (학생용 모델 또는 ProblemSet 설정)</option>
                  {models.map((m) => (
                    <option key={`${m.provider}|${m.model_id}`} value={`${m.provider}|${m.model_id}`}>
                      {m.provider} · {m.display_name} (in ${m.input_per_1m_usd}/M · out ${m.output_per_1m_usd}/M)
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-start gap-2 text-caption">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-semibold">이미 채점된 attempt도 재채점</span>
                  <div className="text-text-tertiary text-[11px]">
                    체크 안 하면 manual_score 비어있는 것만 채점. 모델 바꿔서 재시도 시 체크.
                  </div>
                </div>
              </label>

              <div className="bg-cream-100 border border-cream-300 rounded p-3">
                {previewing ? (
                  <div className="flex items-center gap-2 text-caption text-text-tertiary">
                    <Loader2 size={14} className="animate-spin" /> 미리보기 계산 중…
                  </div>
                ) : preview ? (
                  <div className="space-y-1 text-caption">
                    <div className="flex items-center gap-2">
                      <DollarSign size={14} className="text-text-tertiary" />
                      <span className="font-semibold">예상 비용:</span>
                      <span className="text-text-primary font-mono">
                        ${preview.estimated_cost_usd.toFixed(4)}
                      </span>
                      <span className="text-text-tertiary">
                        ({preview.eligible_attempts}건 × 평균 800 토큰 추정)
                      </span>
                    </div>
                    {preview.model_label && (
                      <div className="text-text-tertiary">
                        모델: {preview.provider} · {preview.model_label}
                      </div>
                    )}
                    {!preview.provider && (
                      <div className="flex items-center gap-1 text-amber-700">
                        <AlertTriangle size={12} />
                        provider/model 미설정 — /system/llm/config에서 학생용 기본 모델 지정 필요
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-caption text-text-tertiary">미리보기 없음</div>
                )}
              </div>

              <div className="text-caption text-text-tertiary">
                <div className="font-semibold mb-1">동작 안내</div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  <li>essay/manual/llm grader 문제만 채점 (객관식·단답·수치는 자동채점 그대로)</li>
                  <li>각 attempt에 점수(0~1) + 피드백 자동 저장. "(AI 채점) " prefix.</li>
                  <li>교사가 결과 페이지에서 수동 override 가능 (override 시 prefix 제거).</li>
                  <li>실패한 attempt는 grading_status=failed로 마크 — 다시 실행하거나 수동 채점.</li>
                </ul>
              </div>
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                <div className="text-body font-semibold text-emerald-900 mb-1">채점 완료</div>
                <div className="text-caption text-emerald-800 space-y-0.5">
                  <div>총 {result.total}건 — 성공 {result.graded}건, 실패 {result.failed}건</div>
                  <div>총 비용: <span className="font-mono">${result.total_cost_usd.toFixed(6)}</span></div>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 text-caption">
                  <div className="font-semibold text-amber-900 mb-1">오류 ({result.errors.length})</div>
                  <ul className="space-y-0.5 max-h-32 overflow-y-auto text-[11px]">
                    {result.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>
                        <span className="font-mono">#{e.attempt_id ?? "-"}</span>: {e.message}
                      </li>
                    ))}
                    {result.errors.length > 10 && (
                      <li className="italic">…+{result.errors.length - 10}건 더</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            {result ? "닫기" : "취소"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleRun}
              disabled={running || previewing || !preview?.eligible_attempts}
              className="px-4 py-1.5 text-caption bg-accent-default text-white rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {running ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> 채점 중…
                </>
              ) : (
                <>
                  <Bot size={12} /> 채점 실행
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
