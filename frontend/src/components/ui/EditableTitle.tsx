"use client";

/**
 * 인라인 편집 가능한 제목 — 더블클릭 시 input으로 전환.
 *
 * - canEdit=false면 그냥 정적 텍스트
 * - 더블클릭 → input + autofocus + 전체 선택
 * - Enter / blur → onSave(newValue) (변경 없으면 호출 안 함)
 * - Esc → 취소 (원래 값으로 복원)
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onSave: (v: string) => void | Promise<void>;
  canEdit: boolean;
  /** 표시용 className (h1/큰 글씨 등) */
  className?: string;
  placeholder?: string;
}

export function EditableTitle({
  value, onSave, canEdit, className = "text-title font-semibold text-text-primary",
  placeholder = "제목 없음",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // 외부 value 변경 시 draft 동기화 (편집 중이 아닐 때만)
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) {
      await onSave(next);
    } else {
      setDraft(value);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing && canEdit) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        placeholder={placeholder}
        className={`${className} bg-transparent border-b-2 border-accent outline-none w-full max-w-2xl px-1 -mx-1`}
      />
    );
  }

  return (
    <h1
      onDoubleClick={() => { if (canEdit) setEditing(true); }}
      className={`${className} ${canEdit ? "cursor-text hover:bg-bg-secondary rounded px-1 -mx-1" : ""} truncate`}
      title={canEdit ? "더블클릭하여 제목 수정" : undefined}
    >
      {value || <span className="text-text-tertiary">{placeholder}</span>}
    </h1>
  );
}
