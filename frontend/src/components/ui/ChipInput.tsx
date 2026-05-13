"use client";

/**
 * 칩 입력 컴포넌트 — 항목을 하나씩 입력해서 chip으로 누적.
 *
 * 동작:
 *   - input + Enter 또는 콤마 → 추가
 *   - chip의 X 클릭 → 삭제
 *   - 빈 input + Backspace → 마지막 chip 삭제
 *   - 중복은 무시
 */

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

interface ChipInputProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  /** 입력값 정규화 (예: trim, lowercase). 미지정 시 trim만. */
  normalize?: (v: string) => string;
}

export function ChipInput({ items, onChange, placeholder, normalize }: ChipInputProps) {
  const [draft, setDraft] = useState("");

  const norm = (v: string) => (normalize ? normalize(v) : v.trim());

  const addOne = (raw: string) => {
    const v = norm(raw);
    if (!v) return;
    if (items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  };

  const removeAt = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addOne(draft);
    } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
      e.preventDefault();
      removeAt(items.length - 1);
    }
  };

  // 붙여넣기 시 콤마/줄바꿈 다중 추가
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\n,]/.test(text)) return;
    e.preventDefault();
    const parts = text.split(/[\n,]/).map(norm).filter(Boolean);
    const next = [...items];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
  };

  return (
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5 border border-border-default rounded bg-bg-primary min-h-[40px]">
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-caption bg-blue-50 text-text-primary border border-blue-200 rounded"
        >
          {it}
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-text-tertiary hover:text-status-error"
            aria-label={`${it} 삭제`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        onBlur={() => draft && addOne(draft)}
        placeholder={items.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] outline-none text-body bg-transparent"
      />
    </div>
  );
}
