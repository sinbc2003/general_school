"use client";

/**
 * 인라인 편집 셀 — 텍스트/숫자/드롭다운 모드. 클릭 → 편집 → Enter 저장 / Esc 취소.
 *
 * 사용 예 (텍스트):
 *   <InlineCell value={row.name} onSave={async (v) => api.put(...)} />
 *
 * 사용 예 (드롭다운):
 *   <InlineCell
 *     value={row.grade}
 *     options={[{value: "1", label: "1학년"}, ...]}
 *     onSave={async (v) => api.put(...)}
 *   />
 *
 * onSave는 비동기 가능. 실패하면 throw → 자동으로 옛 값으로 복귀.
 */

import { useState, type KeyboardEvent } from "react";

export interface InlineCellOption {
  value: string;
  label: string;
}

interface InlineCellProps {
  value: string | number | null | undefined;
  onSave: (newValue: string) => void | Promise<void>;
  /** 드롭다운 옵션. 지정 시 select 모드 */
  options?: InlineCellOption[];
  /** input 타입 (옵션 미지정 시) */
  type?: "text" | "number";
  placeholder?: string;
  /** 셀 너비 클래스 (예: "w-20") */
  width?: string;
  /** 비활성화 (편집 불가) */
  disabled?: boolean;
}

export function InlineCell({
  value,
  onSave,
  options,
  type = "text",
  placeholder,
  width = "w-20",
  disabled,
}: InlineCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    if (disabled) return;
    setDraft(value == null ? "" : String(value));
    setEditing(true);
  };

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (String(value ?? "") === next) return;  // 변경 없음
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      // 실패 시 옛 값으로 복귀 (부모가 데이터 다시 fetch하면 알아서 동기화)
      setDraft(value == null ? "" : String(value));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    if (options) {
      return (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e: KeyboardEvent<HTMLSelectElement>) => {
            if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          className={`${width} px-1 py-0.5 text-caption border border-accent rounded bg-bg-primary`}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
        placeholder={placeholder}
        className={`${width} px-1 py-0.5 text-caption border border-accent rounded bg-bg-primary`}
      />
    );
  }

  const raw = value == null || value === "" ? "" : String(value);
  let display = raw;
  if (options && raw) {
    const opt = options.find((o) => o.value === raw);
    if (opt) display = opt.label;
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      disabled={disabled || saving}
      className={`${width} text-left px-1 py-0.5 text-caption rounded border border-transparent transition-colors ${
        disabled
          ? "cursor-default text-text-tertiary"
          : "hover:bg-blue-50 hover:border-blue-200"
      } ${saving ? "opacity-50" : ""}`}
      title={disabled ? "" : "클릭해서 편집"}
    >
      {display || <span className="text-text-tertiary">{placeholder || "—"}</span>}
    </button>
  );
}
