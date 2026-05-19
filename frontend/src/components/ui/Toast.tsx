"use client";

/**
 * 간단한 toast 알림 — Google Classroom 식 좌하단 검은 박스.
 *
 *  사용:
 *    import { useToast } from "@/components/ui/Toast";
 *    const { show } = useToast();
 *    show("과제가 생성됨");
 *
 *  Provider 설치 위치: 각 layout (admin / student) — 한 번만.
 *
 *  최대 3개 동시 표시. 각 5초 후 자동 사라짐.
 */

import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

export type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}

interface ToastContextValue {
  show: (msg: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Provider 미설치 시 console fallback (앱 부팅 직후 등)
    return {
      show: (msg) => {
        // eslint-disable-next-line no-console
        console.log("[toast]", msg);
      },
    };
  }
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setItems((prev) => [...prev.slice(-2), { id, msg, kind }]); // 최대 3개
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const close = (id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* 좌하단 stack */}
      <div className="fixed bottom-4 left-4 z-[100] space-y-2 pointer-events-none">
        {items.map((t) => (
          <ToastBubble key={t.id} item={t} onClose={() => close(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastBubble({
  item, onClose,
}: { item: ToastItem; onClose: () => void }) {
  // 부드러운 등장 애니메이션 (CSS transition)
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const Icon =
    item.kind === "success" ? CheckCircle2
    : item.kind === "error" ? AlertCircle
    : null;

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2.5 bg-[#202124] text-white rounded shadow-lg min-w-[260px] max-w-[400px] transition-all duration-200 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {Icon && (
        <Icon
          size={16}
          className={
            item.kind === "success" ? "text-green-400"
            : item.kind === "error" ? "text-red-400"
            : "text-white"
          }
        />
      )}
      <span className="text-[13px] flex-1">{item.msg}</span>
      <button
        onClick={onClose}
        className="p-1 hover:bg-white/10 rounded text-white/70"
        title="닫기"
      >
        <X size={13} />
      </button>
    </div>
  );
}
