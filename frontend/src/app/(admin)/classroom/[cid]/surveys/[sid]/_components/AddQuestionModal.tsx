"use client";

/**
 * 질문 추가 모달. 유형 → 텍스트 → 옵션/평점 → 필수 토글.
 *
 * 객관식·체크박스는 옵션 줄바꿈 구분 입력.
 * 평점은 rating_max (2~10).
 */

import { useState } from "react";
import { X, Save } from "lucide-react";
import { api } from "@/lib/api/client";
import { TYPE_LABELS, type QType } from "./_types";

interface AddQuestionModalProps {
  sid: number;
  onClose: () => void;
  onSaved: () => void;
}

export function AddQuestionModal({ sid, onClose, onSaved }: AddQuestionModalProps) {
  const [questionText, setQuestionText] = useState("");
  const [type, setType] = useState<QType>("short_text");
  const [isRequired, setIsRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");
  const [ratingMax, setRatingMax] = useState(5);
  const [saving, setSaving] = useState(false);

  const needsOptions = type === "single_choice" || type === "multi_choice";
  const needsRating = type === "rating";

  const save = async () => {
    if (!questionText.trim()) return alert("질문 내용을 입력하세요");
    const opts = optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (needsOptions && opts.length < 2) {
      return alert("객관식·체크박스는 옵션 2개 이상 필요");
    }
    setSaving(true);
    try {
      await api.post(`/api/classroom/surveys/${sid}/questions`, {
        question_text: questionText.trim(),
        question_type: type,
        is_required: isRequired,
        options: needsOptions ? opts : null,
        rating_max: needsRating ? ratingMax : 5,
      });
      onSaved();
    } catch (e: any) {
      alert(e?.detail || "추가 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold">질문 추가</h2>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-caption text-text-secondary block mb-1">유형</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as QType)}
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              {(Object.keys(TYPE_LABELS) as QType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-caption text-text-secondary block mb-1">질문 *</label>
            <textarea
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              rows={2}
              placeholder="예: 오늘 수업이 얼마나 이해되었나요?"
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary resize-y"
            />
          </div>
          {needsOptions && (
            <div>
              <label className="text-caption text-text-secondary block mb-1">
                옵션 (줄바꿈 구분, 2개 이상)
              </label>
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                placeholder="옵션 1&#10;옵션 2&#10;옵션 3"
                className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary resize-y font-mono text-caption"
              />
            </div>
          )}
          {needsRating && (
            <div>
              <label className="text-caption text-text-secondary block mb-1">
                평점 최댓값 (1 ~ {ratingMax})
              </label>
              <input
                type="number"
                min={2}
                max={10}
                value={ratingMax}
                onChange={(e) =>
                  setRatingMax(Math.max(2, Math.min(10, Number(e.target.value))))
                }
                className="w-20 px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-caption cursor-pointer">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
            />
            필수 답변
          </label>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border-default">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-caption border border-border-default rounded"
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded disabled:opacity-50"
          >
            <Save size={12} /> {saving ? "추가 중..." : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
