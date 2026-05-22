"use client";

/**
 * 협업 도구 운영 안내 모달.
 *
 * 협업 문서/시트/덱/한컴 페이지 첫 진입 시 localStorage 키가 없으면 자동 표시.
 * "다시 보지 않기" 체크 시 다음부터 보이지 않음 (localStorage 저장).
 *
 * - docs/sheets/decks: "20명 이상 동시 편집 시 지연 가능 — 모둠별 분산 권장"
 * - hwps: "단독 편집만 지원 — 동시 편집은 TipTap 협업 문서 사용"
 *
 * 사용:
 *   <CollabPrecautionModal toolKind="docs" />
 *
 * 디자인 톤: cream-100 배경 + accent 보더 + rounded-xl (CLAUDE.md 정책).
 */

import { useEffect, useState } from "react";
import { Info, Users, AlertTriangle, X } from "lucide-react";

export type CollabToolKind = "docs" | "sheets" | "decks" | "hwps";

interface Props {
  toolKind: CollabToolKind;
  /** 자체 storageKey 지정 (기본 `collab_precaution_seen_v1`). */
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "collab_precaution_seen_v1";

const TOOL_LABEL: Record<CollabToolKind, string> = {
  docs: "협업 문서",
  sheets: "협업 스프레드시트",
  decks: "협업 프리젠테이션",
  hwps: "한컴 문서",
};

export default function CollabPrecautionModal({
  toolKind,
  storageKey = DEFAULT_STORAGE_KEY,
}: Props) {
  // SSR 보호 — 클라이언트 마운트 후에만 표시 여부 판정
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(true);

  useEffect(() => {
    setMounted(true);
    try {
      const seen = localStorage.getItem(storageKey);
      if (!seen) setOpen(true);
    } catch {
      // localStorage 차단된 환경 — 모달 표시 안 함 (UX 가벼움 우선)
    }
  }, [storageKey]);

  if (!mounted || !open) return null;

  const isHwp = toolKind === "hwps";

  const handleClose = () => {
    try {
      if (dontShow) localStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="collab-precaution-title"
    >
      <div
        className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-md flex flex-col border border-cream-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cream-200 bg-cream-100 rounded-t-xl">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-accent" />
            <h2
              id="collab-precaution-title"
              className="text-body font-semibold"
            >
              협업 도구 운영 안내
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-cream-200 rounded-full"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 space-y-3 text-body text-text-primary">
          <div className="text-caption text-text-tertiary">
            현재 도구: <b className="text-text-primary">{TOOL_LABEL[toolKind]}</b>
          </div>

          {isHwp ? (
            <>
              <div className="flex items-start gap-2 p-3 bg-cream-100 border border-cream-300 rounded-lg">
                <AlertTriangle
                  size={16}
                  className="text-amber-600 flex-shrink-0 mt-0.5"
                />
                <div className="text-caption leading-relaxed">
                  한컴 문서는 <b>단독 편집만 지원</b>합니다. 한 명만 편집하고
                  다른 사람은 보기 모드로 들어와야 합니다.
                </div>
              </div>
              <div className="text-caption text-text-secondary leading-relaxed">
                동시 편집이 필요하면 <b>협업 문서(Docs)</b>를 사용하세요. 한컴
                문서는 단독 편집 + 보기 공유 + 다운로드용입니다.
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 p-3 bg-cream-100 border border-cream-300 rounded-lg">
                <Users
                  size={16}
                  className="text-accent flex-shrink-0 mt-0.5"
                />
                <div className="text-caption leading-relaxed">
                  한 문서에 <b>20명 이상 동시 편집</b> 시 지연이 발생할 수
                  있습니다.
                </div>
              </div>
              <div className="text-caption text-text-secondary leading-relaxed">
                <b>모둠별로 문서를 분산</b>하면 안정적으로 작동합니다. 예) 35명
                학급은 5~7명 모둠별로 문서를 나눠 사용하세요.
              </div>
            </>
          )}
        </div>

        {/* 액션 */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-cream-200">
          <label className="flex items-center gap-2 text-caption text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="accent-accent"
            />
            다시 보지 않기
          </label>
          <button
            onClick={handleClose}
            className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover transition"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
