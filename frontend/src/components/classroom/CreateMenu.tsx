"use client";

/**
 * "+ 만들기" 드롭다운 메뉴 — Google Classroom의 수업 과제 페이지 우상단.
 *
 * 항목:
 *   📋 과제          → post_type=assignment_ref PostForm 열기
 *   📁 자료          → post_type=material PostForm 열기
 *   📄 협업 문서     → /classroom/[cid]/docs 페이지로 (또는 inline 생성 후 이동)
 *   📊 설문지        → /classroom/[cid]/surveys 페이지로
 *
 * onAction(kind) 콜백으로 parent가 처리.
 */

import { useRef, useState, useEffect } from "react";
import { Plus, FileText, Folder, Edit3, ClipboardList } from "lucide-react";

export type CreateActionKind = "assignment" | "material" | "doc" | "survey";

const MENU_ITEMS: {
  kind: CreateActionKind;
  label: string;
  desc: string;
  icon: any;
  iconBg: string;
  iconColor: string;
}[] = [
  {
    kind: "assignment",
    label: "과제",
    desc: "수행평가·제출물 안내",
    icon: Edit3,
    iconBg: "#dbeafe",
    iconColor: "#1d4ed8",
  },
  {
    kind: "material",
    label: "자료",
    desc: "수업 자료·참고 링크 공유",
    icon: Folder,
    iconBg: "#dcfce7",
    iconColor: "#15803d",
  },
  {
    kind: "doc",
    label: "협업 문서",
    desc: "Google Docs 식 실시간 동시 편집",
    icon: FileText,
    iconBg: "#fef3c7",
    iconColor: "#a16207",
  },
  {
    kind: "survey",
    label: "설문지",
    desc: "응답 수집 + 단축 링크 / QR",
    icon: ClipboardList,
    iconBg: "#fce7f3",
    iconColor: "#be185d",
  },
];

interface CreateMenuProps {
  onAction: (kind: CreateActionKind) => void;
  /** 기본 색 (배너 tone.accent와 어울리게) */
  accentColor?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function CreateMenu({
  onAction, accentColor, disabled, disabledReason,
}: CreateMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title={disabled ? disabledReason : "새로 만들기"}
        className="flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-medium text-white rounded-full shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed transition"
        style={{ backgroundColor: accentColor || "#6366f1" }}
      >
        <Plus size={15} /> 만들기
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-30 bg-bg-primary border border-border-default rounded-lg shadow-lg w-[260px] py-1 overflow-hidden">
          {MENU_ITEMS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.kind}
                type="button"
                onClick={() => { setOpen(false); onAction(m.kind); }}
                className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-bg-secondary text-left transition"
              >
                <div
                  className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: m.iconBg, color: m.iconColor }}
                >
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium text-text-primary">{m.label}</div>
                  <div className="text-[11.5px] text-text-tertiary leading-tight mt-0.5">
                    {m.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
