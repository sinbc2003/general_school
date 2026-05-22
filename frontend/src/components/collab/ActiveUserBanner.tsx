"use client";

/**
 * 동접자 수 경고 배너.
 *
 * Yjs/Hocuspocus awareness 의 사용자 수가 20명 이상일 때만 노출.
 * 모둠 분산 권장 메시지.
 *
 * 사용 (CollabEditor / SheetEditor / DeckEditor 안에서):
 *   const [activeCount, setActiveCount] = useState(0);
 *   useEffect(() => {
 *     const update = () => setActiveCount(provider.awareness?.getStates()?.size ?? 0);
 *     provider.awareness?.on("change", update);
 *     update();
 *     return () => provider.awareness?.off("change", update);
 *   }, [provider]);
 *   ...
 *   <ActiveUserBanner count={activeCount} />
 */

import { AlertTriangle } from "lucide-react";

interface Props {
  count: number;
  /** 임계값 (기본 20명). */
  threshold?: number;
}

export default function ActiveUserBanner({ count, threshold = 20 }: Props) {
  if (count < threshold) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="border border-amber-200 bg-amber-50 px-3 py-2 rounded-lg flex items-center gap-2 text-caption text-amber-900"
    >
      <AlertTriangle size={14} className="flex-shrink-0 text-amber-700" />
      <span>
        현재 <b>{count}명</b> 동시 편집 중 — 지연이 발생할 수 있습니다.{" "}
        <b>모둠별 분산</b>을 권장합니다.
      </span>
    </div>
  );
}
