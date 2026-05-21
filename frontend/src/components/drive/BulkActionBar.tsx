"use client";

/**
 * 드라이브 다중 선택 시 상단 fixed pill 액션 바.
 *
 * Google Drive 식: "[X] N개 선택됨 | 휴지통/복구/영구삭제".
 * trash 탭일 때는 복구/영구삭제, 그 외에는 휴지통으로 이동.
 */

import { X, Trash2, RotateCcw } from "lucide-react";

interface Props {
  count: number;
  trashTab: boolean;
  onClear: () => void;
  onSoftDelete: () => void;
  onRestore: () => void;
  onPermanent: () => void;
}

export function BulkActionBar({
  count, trashTab, onClear, onSoftDelete, onRestore, onPermanent,
}: Props) {
  if (count === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 bg-text-primary text-white rounded-full shadow-xl px-5 py-2 flex items-center gap-3">
      <button onClick={onClear} className="text-white/70 hover:text-white" title="선택 해제 (Esc)">
        <X size={16} />
      </button>
      <span className="text-caption font-medium">{count}개 선택됨</span>
      <div className="w-px h-5 bg-white/20" />
      {trashTab ? (
        <>
          <button onClick={onRestore} className="inline-flex items-center gap-1 text-caption text-white/90 hover:text-white">
            <RotateCcw size={13} /> 복구
          </button>
          <button onClick={onPermanent} className="inline-flex items-center gap-1 text-caption text-red-300 hover:text-red-200">
            <Trash2 size={13} /> 영구 삭제
          </button>
        </>
      ) : (
        <button onClick={onSoftDelete} className="inline-flex items-center gap-1 text-caption text-white/90 hover:text-white">
          <Trash2 size={13} /> 휴지통으로 이동
        </button>
      )}
    </div>
  );
}
