"use client";

/**
 * 공통 Modal 컴포넌트 — overlay + 중앙 정렬 패널 + ESC 닫기.
 *
 * 사용 예:
 *   <Modal open={show} onClose={() => setShow(false)} title="제목" maxWidth="xl">
 *     <div>본문</div>
 *     <ModalFooter>
 *       <button onClick={...}>취소</button>
 *       <button onClick={...}>확인</button>
 *     </ModalFooter>
 *   </Modal>
 */

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

type MaxWidth = "sm" | "md" | "lg" | "xl" | "2xl";
const MAX_WIDTH_CLS: Record<MaxWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  maxWidth?: MaxWidth;
  children: ReactNode;
  /** false면 ESC/overlay click으로 닫히지 않음 */
  dismissable?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  maxWidth = "xl",
  children,
  dismissable = true,
}: ModalProps) {
  useEffect(() => {
    if (!open || !dismissable) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, dismissable, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={dismissable ? onClose : undefined}
    >
      <div
        className={`bg-bg-primary rounded-lg border border-border-default w-full ${MAX_WIDTH_CLS[maxWidth]} max-h-[90vh] overflow-y-auto p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || icon) && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-body font-medium text-text-primary flex items-center gap-2">
              {icon}
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary"
              aria-label="닫기"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Modal 하단 버튼 그룹 — 오른쪽 정렬, 일관된 간격 */
export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 mt-5">{children}</div>;
}
