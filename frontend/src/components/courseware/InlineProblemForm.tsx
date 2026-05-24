"use client";

/**
 * 문제 1개 inline 입력 — 출제 모달 안에서 사용.
 *
 * type별 answer_data UI 분기:
 *  - multiple_choice : choices 입력 (한 줄당 1보기) + 정답 체크박스
 *  - short_answer    : 정답 텍스트 + case_sensitive 토글
 *  - numeric         : 정답값 + tolerance
 *  - essay           : 채점 기준(rubric, 자동채점 X)
 */

import { useEffect, useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { ProblemInline, ProblemType } from "./types";
import { DIFFICULTY_OPTIONS, TYPE_OPTIONS } from "./types";

interface Props {
  index: number;
  value: ProblemInline;
  onChange: (next: ProblemInline) => void;
  onRemove: () => void;
}

export function InlineProblemForm({ index, value, onChange, onRemove }: Props) {
  const update = <K extends keyof ProblemInline>(k: K, v: ProblemInline[K]) =>
    onChange({ ...value, [k]: v });

  const updateAnswerData = (patch: Record<string, any>) =>
    onChange({ ...value, answer_data: { ...(value.answer_data || {}), ...patch } });

  const onTypeChange = (newType: ProblemType) => {
    // type 바꾸면 grader_type도 default로 함께 변경
    const opt = TYPE_OPTIONS.find((o) => o.value === newType);
    const grader = opt?.grader || "exact";
    const baseAd: Record<string, any> = { grader_type: grader };
    if (newType === "multiple_choice") {
      baseAd.choices = value.answer_data?.choices || ["", "", "", ""];
      baseAd.correct = value.answer_data?.correct || [];
    } else if (newType === "short_answer") {
      baseAd.correct = value.answer_data?.correct || "";
    } else if (newType === "numeric") {
      baseAd.value = value.answer_data?.value ?? 0;
      baseAd.tolerance = value.answer_data?.tolerance ?? 0;
    } else if (newType === "essay") {
      baseAd.rubric = value.answer_data?.rubric || "";
    }
    onChange({ ...value, type: newType, answer_data: baseAd });
  };

  const ad = value.answer_data || {};

  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-4 relative">
      <div className="flex items-center justify-between mb-3">
        <div className="text-caption text-text-tertiary font-semibold">문제 {index + 1}</div>
        <button
          type="button"
          onClick={onRemove}
          className="text-text-tertiary hover:text-red-600 p-1"
          aria-label="삭제"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <label className="text-caption">
          <div className="text-text-tertiary mb-1">유형</div>
          <select
            value={value.type}
            onChange={(e) => onTypeChange(e.target.value as ProblemType)}
            className="w-full px-2 py-1.5 border border-border-default rounded text-body"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="text-caption">
          <div className="text-text-tertiary mb-1">난이도</div>
          <select
            value={value.difficulty || "medium"}
            onChange={(e) => update("difficulty", e.target.value as any)}
            className="w-full px-2 py-1.5 border border-border-default rounded text-body"
          >
            {DIFFICULTY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="text-caption">
          <div className="text-text-tertiary mb-1">과목</div>
          <input
            value={value.subject || ""}
            onChange={(e) => update("subject", e.target.value)}
            placeholder="예: 수학"
            className="w-full px-2 py-1.5 border border-border-default rounded text-body"
          />
        </label>
      </div>

      <label className="block text-caption mb-3">
        <div className="text-text-tertiary mb-1">문제 본문</div>
        <textarea
          value={value.content}
          onChange={(e) => update("content", e.target.value)}
          placeholder="문제를 입력하세요 (수식은 LaTeX $...$ 가능)"
          rows={3}
          className="w-full px-2 py-1.5 border border-border-default rounded text-body font-mono"
        />
      </label>

      {/* 정답 영역 (type별 분기) */}
      {value.type === "multiple_choice" && (
        <div className="mb-3">
          <div className="text-caption text-text-tertiary mb-1">보기 + 정답 (정답에 체크)</div>
          <div className="space-y-1">
            {(ad.choices || ["", "", "", ""]).map((c: string, i: number) => {
              const letter = String.fromCharCode(65 + i); // A, B, C, ...
              const isCorrect = (ad.correct || []).includes(letter);
              return (
                <div key={i} className="flex items-center gap-2">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={isCorrect}
                      onChange={(e) => {
                        const cur = new Set(ad.correct || []);
                        if (e.target.checked) cur.add(letter);
                        else cur.delete(letter);
                        updateAnswerData({ correct: Array.from(cur) });
                      }}
                    />
                    <span className="text-caption font-mono w-5">{letter}</span>
                  </label>
                  <input
                    value={c}
                    onChange={(e) => {
                      const next = [...(ad.choices || [])];
                      next[i] = e.target.value;
                      updateAnswerData({ choices: next });
                    }}
                    placeholder={`보기 ${letter}`}
                    className="flex-1 px-2 py-1 border border-border-default rounded text-body"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...(ad.choices || [])];
                      next.splice(i, 1);
                      const cur = (ad.correct || []).filter((x: string) => x !== letter);
                      updateAnswerData({ choices: next, correct: cur });
                    }}
                    className="text-text-tertiary hover:text-red-600 p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                updateAnswerData({ choices: [...(ad.choices || []), ""] })
              }
              className="text-caption text-text-secondary hover:text-text-primary"
            >
              + 보기 추가
            </button>
          </div>
        </div>
      )}

      {value.type === "short_answer" && (
        <div className="mb-3">
          <div className="text-caption text-text-tertiary mb-1">정답</div>
          <input
            value={ad.correct || ""}
            onChange={(e) => updateAnswerData({ correct: e.target.value })}
            placeholder="정답 (대소문자 매칭은 아래 체크)"
            className="w-full px-2 py-1.5 border border-border-default rounded text-body"
          />
          <label className="flex items-center gap-1 mt-1 text-caption text-text-tertiary">
            <input
              type="checkbox"
              checked={!!ad.case_sensitive}
              onChange={(e) => updateAnswerData({ case_sensitive: e.target.checked })}
            />
            대소문자 구분
          </label>
        </div>
      )}

      {value.type === "numeric" && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="text-caption">
            <div className="text-text-tertiary mb-1">정답값</div>
            <input
              type="number"
              step="any"
              value={ad.value ?? ""}
              onChange={(e) => updateAnswerData({ value: parseFloat(e.target.value) })}
              className="w-full px-2 py-1.5 border border-border-default rounded text-body"
            />
          </label>
          <label className="text-caption">
            <div className="text-text-tertiary mb-1">허용 오차 (±)</div>
            <input
              type="number"
              step="any"
              value={ad.tolerance ?? 0}
              onChange={(e) => updateAnswerData({ tolerance: parseFloat(e.target.value) })}
              className="w-full px-2 py-1.5 border border-border-default rounded text-body"
            />
          </label>
        </div>
      )}

      {value.type === "essay" && (
        <div className="mb-3">
          <div className="text-caption text-text-tertiary mb-1">
            채점 기준 (rubric) — AI 채점 시 핵심 지침이 됩니다
          </div>
          <textarea
            value={ad.rubric || ""}
            onChange={(e) => updateAnswerData({ rubric: e.target.value })}
            placeholder="예: 핵심 키워드 3개 이상 포함 시 만점, 1~2개 부분점수"
            rows={2}
            className="w-full px-2 py-1.5 border border-border-default rounded text-body"
          />
        </div>
      )}

      {/* Few-shot rubric — AI 채점 정확도 +26% (essay/short_answer/numeric 모두) */}
      {(value.type === "essay" || value.type === "short_answer" || value.type === "numeric") && (
        <FewShotExamplesEditor
          value={ad.examples || []}
          onChange={(next) => updateAnswerData({ examples: next })}
        />
      )}

      <label className="block text-caption">
        <div className="text-text-tertiary mb-1">해설 (선택, 학생에게 마감 후 공개)</div>
        <textarea
          value={value.solution || ""}
          onChange={(e) => update("solution", e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 border border-border-default rounded text-body"
        />
      </label>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Few-shot examples 입력 (AI 채점 calibration)
// ─────────────────────────────────────────────────────────────────────────────

interface ExampleItem {
  answer: string;
  score: number;
  comment?: string;
}

function FewShotExamplesEditor({
  value, onChange,
}: {
  value: ExampleItem[];
  onChange: (next: ExampleItem[]) => void;
}) {
  const [expanded, setExpanded] = useState(value.length > 0);

  const update = (i: number, patch: Partial<ExampleItem>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const addRow = () => {
    onChange([...value, { answer: "", score: 0.5, comment: "" }]);
    setExpanded(true);
  };

  const removeRow = (i: number) => {
    const next = [...value];
    next.splice(i, 1);
    onChange(next);
  };

  return (
    <div className="mb-3 border border-cream-300 bg-cream-50 rounded p-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-caption text-text-secondary"
      >
        <span className="font-semibold">
          채점 예시 (AI 채점 정확도 향상, {value.length}/5)
        </span>
        <span className="text-text-tertiary text-[11px]">
          {expanded ? "▲ 접기" : "▼ 펼치기"}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          <div className="text-[11px] text-text-tertiary">
            점수대별 모범 답안 2~3개를 입력하면 AI가 같은 기준으로 채점합니다.
            정확도 약 +26%.
          </div>
          {value.map((ex, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <input
                type="text"
                value={ex.answer}
                onChange={(e) => update(i, { answer: e.target.value })}
                placeholder="학생 답안 예시"
                className="flex-1 px-2 py-1 border border-border-default rounded text-body text-[12px]"
              />
              <input
                type="number"
                min={0}
                max={1}
                step="0.1"
                value={ex.score}
                onChange={(e) => update(i, { score: parseFloat(e.target.value || "0") })}
                className="w-16 px-2 py-1 border border-border-default rounded text-body text-[12px]"
                title="점수 (0~1)"
              />
              <input
                type="text"
                value={ex.comment || ""}
                onChange={(e) => update(i, { comment: e.target.value })}
                placeholder="이유 (선택)"
                className="flex-1 px-2 py-1 border border-border-default rounded text-body text-[12px]"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-text-tertiary hover:text-red-600 p-1"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {value.length < 5 && (
            <button
              type="button"
              onClick={addRow}
              className="text-[11px] text-text-secondary hover:text-text-primary"
            >
              + 예시 추가
            </button>
          )}
        </div>
      )}
    </div>
  );
}
