"use client";

/**
 * Drive에서 우클릭 → "공유"로 진입했을 때, 도구별 detail fetch 후
 * ShareDocModal을 마운트한다. (drive 목록은 owner_id/access_mode 등
 * 일부 메타만 갖고 있어 detail 한 번 더 fetch 필요.)
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { ShareDocModal } from "@/components/classroom/ShareDocModal";

interface Target {
  type: "docs" | "sheets" | "decks" | "surveys" | "hwps";
  id: number;
  title: string;
}

const ENTITY_TYPE_MAP = {
  docs: "doc",
  sheets: "sheet",
  decks: "deck",
  hwps: "hwp",
} as const;

const API_PATH_MAP = {
  docs: "docs",
  sheets: "sheets",
  decks: "decks",
  hwps: "hwps",
} as const;

interface DetailLike {
  id: number;
  owner_id: number;
  title: string;
  access_mode: string;
  permission: { can_share: boolean };
}

export function ShareFromDrive({
  target, onClose, onChanged,
}: {
  target: Target;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DetailLike | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target.type === "surveys") {
      setError("설문은 빌더 안에서 공유하세요.");
      return;
    }
    (async () => {
      try {
        const d = await api.get<DetailLike>(
          `/api/classroom/${API_PATH_MAP[target.type as keyof typeof API_PATH_MAP]}/${target.id}`,
        );
        setDetail(d);
      } catch (e: any) {
        setError(e?.detail || e?.message || "조회 실패");
      }
    })();
  }, [target]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl p-5 max-w-sm" onClick={(e) => e.stopPropagation()}>
          <div className="text-body mb-3">{error}</div>
          <button onClick={onClose} className="px-3 py-1.5 text-caption bg-accent text-white rounded">닫기</button>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const entityType = ENTITY_TYPE_MAP[target.type as keyof typeof ENTITY_TYPE_MAP];

  return (
    <ShareDocModal
      entityType={entityType}
      docId={target.id}
      docTitle={detail.title}
      ownerId={detail.owner_id}
      canShare={detail.permission.can_share}
      currentAccessMode={detail.access_mode as any}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}
