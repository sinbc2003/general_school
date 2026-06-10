"use client";

/**
 * "+ 만들기" 드롭다운 메뉴 — Google Classroom의 수업 과제 페이지 우상단.
 *
 * 실제 Google Classroom 만들기 메뉴 구성을 따른다 (그룹 + 구분선):
 *   [글]    📋 과제 / ✅ 퀴즈 과제 / 📁 자료 / 🔁 게시물 재사용
 *   [도구]  📄 협업 문서 / 🖼️ 프리젠테이션 / 📊 설문지
 *   [AI]    🤖 챗봇 (Gem 대응)
 *
 * onAction(kind) 콜백으로 parent가 처리.
 */

import { useRef, useState, useEffect } from "react";
import {
  Plus, FileText, Folder, Edit3, ClipboardList, ListChecks, Repeat2,
  Presentation, Bot,
} from "lucide-react";

export type CreateActionKind =
  | "assignment" | "quiz" | "material" | "reuse"
  | "doc" | "deck" | "survey"
  | "chatbot";

interface MenuItem {
  kind: CreateActionKind;
  label: string;
  desc: string;
  icon: any;
  iconBg: string;
  iconColor: string;
}

// Google Classroom 만들기 메뉴와 같은 그룹 구성 — 그룹 사이 구분선
const MENU_GROUPS: MenuItem[][] = [
  [
    {
      kind: "assignment",
      label: "과제",
      desc: "수행평가·제출물 안내",
      icon: Edit3,
      iconBg: "#dbeafe",
      iconColor: "#1d4ed8",
    },
    {
      kind: "quiz",
      label: "퀴즈 과제",
      desc: "자동 채점 문제 세트",
      icon: ListChecks,
      iconBg: "#ffe4e6",
      iconColor: "#be123c",
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
      kind: "reuse",
      label: "게시물 재사용",
      desc: "내 다른 강좌의 글 가져오기",
      icon: Repeat2,
      iconBg: "#f3f4f6",
      iconColor: "#374151",
    },
  ],
  [
    {
      kind: "doc",
      label: "협업 문서",
      desc: "새 문서를 자료 글로 게시 (동시 편집)",
      icon: FileText,
      iconBg: "#fef3c7",
      iconColor: "#a16207",
    },
    {
      kind: "deck",
      label: "프리젠테이션",
      desc: "새 슬라이드를 자료 글로 게시",
      icon: Presentation,
      iconBg: "#fff7ed",
      iconColor: "#c2410c",
    },
    {
      kind: "survey",
      label: "설문지",
      desc: "새 설문을 자료 글로 게시 (응답 수집)",
      icon: ClipboardList,
      iconBg: "#fce7f3",
      iconColor: "#be185d",
    },
  ],
  [
    {
      kind: "chatbot",
      label: "챗봇",
      desc: "강좌 챗봇을 골라 자료 글로 게시",
      icon: Bot,
      iconBg: "#e0f2fe",
      iconColor: "#0369a1",
    },
  ],
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
        <div className="absolute top-full left-0 mt-1.5 z-30 bg-bg-primary border border-border-default rounded-lg shadow-lg w-[260px] py-1 overflow-hidden max-h-[70vh] overflow-y-auto">
          {MENU_GROUPS.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="border-t border-border-default my-1" />}
              {group.map((m) => {
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
          ))}
        </div>
      )}
    </div>
  );
}
