"use client";

/**
 * AI 도우미 사이드바 — 문서/시트/슬라이드/설문 4개 도구 공통.
 *
 * 동작:
 *   - 교사가 자연어로 요청 (예: "5문제 객관식 설문 만들어줘")
 *   - 백엔드 `/api/tool-ai/chat`이 LLM tool_use 결과 반환
 *   - tool_call이 있으면 카드 형태로 미리보기 + [적용]/[취소] 버튼
 *   - 교사가 적용 클릭 → ApplyHandler 호출 (도구별 실제 변경)
 *
 * 권한:
 *   - 호출 자체가 require_permission("tool.ai_assistant.use") 가드
 *   - 학생은 endpoint 403 → 패널 표시 안 됨
 *
 * 모델:
 *   - super_admin이 /system/llm/models에서 tool_ai_enabled 토글한 것만 노출
 *   - 사용 가능 모델 0개면 안내만 표시
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2, Check, AlertCircle, ChevronDown } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSidebar } from "@/lib/sidebar-context";
import { useAIAssistant } from "@/lib/ai-assistant-context";
import type { ToolKind, ToolModel, ChatTurn, ToolCall, ApplyHandler, ToolChatResponse } from "./types";


interface Props {
  toolKind: ToolKind;
  toolId: number;
  applyHandler: ApplyHandler;
  /** 현재 도구 내용을 LLM 컨텍스트로 첨부 (선택). 3000자까지 사용. */
  getCurrentContent?: () => string;
  open: boolean;
  onClose: () => void;
}

const KIND_LABEL: Record<ToolKind, string> = {
  doc: "문서",
  sheet: "스프레드시트",
  slide: "프리젠테이션",
  survey: "설문지",
};

const SUGGESTIONS_BY_KIND: Record<ToolKind, string[]> = {
  doc: [
    "수업안 템플릿 만들어줘 (학습목표 / 도입 / 전개 / 정리)",
    "이번 주 가정통신문 초안 작성해줘",
    "표 형식 평가 루브릭 추가해줘",
  ],
  sheet: [
    "1학년 1반 출석부 만들어줘 (학번, 이름, 1~5교시)",
    "수행평가 채점 시트 (학번, 이름, 항목 3개, 합계 자동)",
    "성적 통계 (평균/최고/최저) 수식 추가해줘",
  ],
  slide: [
    "함수의 그래프 단원 도입 슬라이드 5장 만들어줘",
    "학부모 총회 발표 자료 8장",
    "수업 마무리 퀴즈 슬라이드 3장",
  ],
  survey: [
    "이번 학기 수업 만족도 설문 8문항 (5점 척도 + 객관식)",
    "진로 탐색 흥미 조사 (객관식 + 단답)",
    "동아리 활동 평가 설문 5문항",
  ],
};


export function AIAssistantPanel({
  toolKind, toolId, applyHandler, getCurrentContent, open, onClose,
}: Props) {
  const [models, setModels] = useState<ToolModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // open 상태를 layout에 전달 → main의 padding-right가 panel 폭만큼 늘어
  // 본문이 panel과 겹치지 않게 옆으로 밀림. open=true 진입 시 좌측 사이드바도
  // 한 번 접음 (사용자가 다시 펼치면 자동 복구 안 함).
  const sidebar = useSidebar();
  const ai = useAIAssistant();
  useEffect(() => {
    if (open) {
      ai.setOpen(true);
      sidebar.setCollapsed(true);
    } else {
      ai.setOpen(false);
    }
    return () => { ai.setOpen(false); };
    // open 외 다른 deps 의도적으로 제외 — sidebar 재펼침/collapse 변화에 영향 X.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 모델 로드
  useEffect(() => {
    if (!open) return;
    setModelsLoading(true);
    api.get<{ items: ToolModel[] }>("/api/tool-ai/models")
      .then((d) => {
        setModels(d.items);
        if (d.items.length > 0 && selectedModelId === null) {
          const firstAvail = d.items.find((m) => m.available);
          setSelectedModelId((firstAvail || d.items[0]).id);
        }
      })
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [open]);

  // 스크롤 끝으로
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, sending]);

  const send = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || !selectedModelId || sending) return;
    setInput("");
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: userText }];
    setTurns(nextTurns);
    setSending(true);
    try {
      const apiMessages = nextTurns.map((t) => ({ role: t.role, content: t.content }));
      const resp = await api.post<ToolChatResponse>("/api/tool-ai/chat", {
        tool_kind: toolKind,
        tool_id: toolId,
        model_id: selectedModelId,
        messages: apiMessages,
        current_content: getCurrentContent ? getCurrentContent().slice(0, 3000) : null,
      });
      setTurns([...nextTurns, {
        role: "assistant",
        content: resp.text,
        tool_calls: resp.tool_calls,
        applied: {},
        error: resp.error || undefined,
      }]);
    } catch (e: any) {
      setTurns([...nextTurns, {
        role: "assistant",
        content: "",
        error: e?.detail || e?.message || "요청 실패",
      }]);
    } finally {
      setSending(false);
    }
  }, [input, selectedModelId, sending, turns, toolKind, toolId, getCurrentContent]);

  const applyOne = async (turnIdx: number, callIdx: number) => {
    const turn = turns[turnIdx];
    if (!turn?.tool_calls) return;
    const call = turn.tool_calls[callIdx];
    if (!call) return;
    try {
      await applyHandler(call);
      setTurns((arr) => arr.map((t, i) =>
        i === turnIdx ? { ...t, applied: { ...(t.applied || {}), [callIdx]: true } } : t,
      ));
    } catch (e: any) {
      alert(`적용 실패: ${e?.message || e}`);
    }
  };

  if (!open) return null;

  return (
    <aside className="fixed right-0 top-0 h-screen w-[380px] bg-white border-l border-[#e8eaed] shadow-xl flex flex-col z-40">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-[#e8eaed] flex items-center gap-2 flex-shrink-0">
        <Sparkles size={16} className="text-[#673ab7]" />
        <div className="font-medium text-text-primary">AI 도우미</div>
        <span className="text-caption text-text-tertiary">· {KIND_LABEL[toolKind]}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-bg-secondary text-text-tertiary"
          title="닫기"
          aria-label="닫기"
        >
          <X size={16} />
        </button>
      </div>

      {/* 모델 드롭다운 */}
      <div className="px-4 py-2 border-b border-[#e8eaed] flex-shrink-0">
        {modelsLoading ? (
          <div className="text-caption text-text-tertiary inline-flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> 모델 로드 중...
          </div>
        ) : models.length === 0 ? (
          <div className="text-caption text-amber-700 inline-flex items-center gap-1.5">
            <AlertCircle size={12} />
            <span>사용 가능 모델 없음.</span>
            <a
              href="/system/llm/models"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >설정 열기</a>
          </div>
        ) : (
          <div className="relative">
            <select
              value={selectedModelId ?? ""}
              onChange={(e) => setSelectedModelId(Number(e.target.value))}
              className="w-full text-caption appearance-none px-2 py-1.5 pr-7 bg-bg-secondary border border-border-default rounded outline-none focus:border-[#673ab7]"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.available}>
                  {m.display_name} ({m.provider}){!m.available ? " — provider 비활성" : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-tertiary" />
          </div>
        )}
      </div>

      {/* 메시지 list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {turns.length === 0 && (
          <div className="space-y-3">
            <div className="text-caption text-text-tertiary">
              무엇을 도와드릴까요? 예시:
            </div>
            <div className="space-y-1.5">
              {SUGGESTIONS_BY_KIND[toolKind].map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  disabled={!selectedModelId || sending}
                  className="w-full text-left text-caption px-3 py-2 bg-bg-secondary hover:bg-cream-100 rounded border border-transparent hover:border-[#673ab7] transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <TurnView
            key={i}
            turn={t}
            onApply={(callIdx) => applyOne(i, callIdx)}
          />
        ))}

        {sending && (
          <div className="text-caption text-text-tertiary inline-flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> 생성 중...
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="border-t border-[#e8eaed] p-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`${KIND_LABEL[toolKind]}에 대해 요청하세요. Shift+Enter 줄바꿈.`}
            disabled={sending || !selectedModelId}
            rows={2}
            className="flex-1 text-body px-3 py-2 border border-border-default rounded focus:border-[#673ab7] outline-none resize-none disabled:bg-bg-secondary"
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || sending || !selectedModelId}
            className="p-2.5 rounded-md bg-[#673ab7] text-white hover:bg-[#5e35b1] disabled:opacity-40"
            title="전송 (Enter)"
            aria-label="전송"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </aside>
  );
}


function TurnView({ turn, onApply }: { turn: ChatTurn; onApply: (callIdx: number) => void }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-[#e8def8] text-text-primary px-3 py-2 rounded-lg text-body whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="space-y-2">
      {turn.error && (
        <div className="text-caption text-status-error inline-flex items-center gap-1 bg-red-50 px-3 py-2 rounded">
          <AlertCircle size={12} /> {turn.error}
        </div>
      )}
      {turn.content && (
        <div className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
          {turn.content}
        </div>
      )}
      {turn.tool_calls && turn.tool_calls.length > 0 && (
        <div className="space-y-2">
          {turn.tool_calls.map((c, i) => (
            <ToolCallCard
              key={i}
              call={c}
              applied={!!turn.applied?.[i]}
              onApply={() => onApply(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function ToolCallCard({
  call, applied, onApply,
}: { call: ToolCall; applied: boolean; onApply: () => void }) {
  const labels: Record<string, string> = {
    doc_append_markdown: "문서 끝에 추가",
    doc_replace_all: "문서 전체 교체",
    sheet_write_cells: "시트 셀 작성",
    slide_add: "슬라이드 추가",
    survey_add_question: "설문 질문 추가",
  };
  const label = labels[call.name] || call.name;
  const summary = summarizeArgs(call);

  return (
    <div className="border border-[#e8eaed] rounded-lg overflow-hidden bg-[#fafafa]">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[#e8eaed]">
        <Sparkles size={11} className="text-[#673ab7]" />
        <span className="text-caption font-medium text-text-primary">{label}</span>
        <div className="flex-1" />
        {applied ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
            <Check size={11} /> 적용됨
          </span>
        ) : (
          <button
            onClick={onApply}
            className="text-[11px] px-2.5 py-1 bg-[#673ab7] text-white rounded hover:bg-[#5e35b1] font-medium"
          >
            적용
          </button>
        )}
      </div>
      <div className="px-3 py-2 text-caption text-text-secondary whitespace-pre-wrap max-h-[200px] overflow-y-auto">
        {summary}
      </div>
    </div>
  );
}


function summarizeArgs(call: ToolCall): string {
  const a = call.arguments || {};
  if (call.name === "doc_append_markdown" || call.name === "doc_replace_all") {
    return a.markdown || "";
  }
  if (call.name === "sheet_write_cells") {
    const cells = Array.isArray(a.cells) ? a.cells : [];
    return `${cells.length}개 셀:\n${cells.slice(0, 8).map((c: any) =>
      `[${c.row},${c.col}] = ${JSON.stringify(c.value)}`,
    ).join("\n")}${cells.length > 8 ? `\n... 외 ${cells.length - 8}개` : ""}`;
  }
  if (call.name === "slide_add") {
    return `제목: ${a.title || "-"}\n\n${a.content_markdown || ""}`;
  }
  if (call.name === "survey_add_question") {
    const opts = Array.isArray(a.options) ? `\n선택지: ${a.options.join(" / ")}` : "";
    return `${a.question_text} [${a.question_type}${a.is_required ? ", 필수" : ""}]${opts}`;
  }
  return JSON.stringify(a, null, 2);
}
