"use client";

/**
 * 업무 및 수업 도구 허브 — 도구 카드 그리드 (Padlet 형식 갤러리 스타일).
 *
 * 각 카드 상단에 도구 실제 화면을 축소한 미니 목업 미리보기.
 * 도구 추가 시 TOOLS 배열에 항목 + preview 목업만 추가하면 카드 자동 노출.
 */

import Link from "next/link";
import {
  Gamepad2, BookA, StickyNote, Dices, ExternalLink, PenTool,
  type LucideIcon,
} from "lucide-react";
import { openToolWindow } from "@/lib/open-tool-window";

interface ToolDef {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  href: string;
  ready: boolean;
  preview: React.ReactNode;
}

/* ── 미니 목업 미리보기 (각 도구 실제 화면 축소판) ───────────────────────── */

function QuizPreview() {
  return (
    <div className="h-full bg-slate-800 p-2.5 flex flex-col gap-1.5">
      {/* 타이머 바 + 문제 줄 */}
      <div className="h-1 rounded-full bg-slate-600 overflow-hidden">
        <div className="h-full w-2/3 bg-violet-400" />
      </div>
      <div className="h-2 w-3/4 rounded bg-slate-500/80 mx-auto mt-1" />
      {/* 4지선다 타일 */}
      <div className="grid grid-cols-2 gap-1.5 flex-1 mt-1">
        {["bg-red-500", "bg-blue-500", "bg-amber-400", "bg-emerald-500"].map((c, i) => (
          <div key={i} className={`${c} rounded-md flex items-center px-1.5`}>
            <span className="w-1.5 h-1.5 rounded-full bg-white/80 mr-1" />
            <span className="h-1 flex-1 rounded bg-white/60" />
          </div>
        ))}
      </div>
    </div>
  );
}

function WordbookPreview() {
  return (
    <div className="h-full bg-gradient-to-br from-sky-100 to-cyan-100 relative overflow-hidden">
      {/* 플래시카드 스택 */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%]">
        <div className="absolute inset-0 translate-x-2 translate-y-2 bg-white/50 rounded-lg border border-sky-200" />
        <div className="absolute inset-0 translate-x-1 translate-y-1 bg-white/70 rounded-lg border border-sky-200" />
        <div className="relative bg-white rounded-lg border border-sky-300 shadow-sm px-3 py-2.5 text-center">
          <div className="text-[13px] font-extrabold text-slate-800 leading-none">apple</div>
          <div className="h-px bg-sky-100 my-1.5" />
          <div className="text-[9px] text-sky-600 font-semibold">사과</div>
        </div>
      </div>
      {/* 라이트너 박스 진행 점 */}
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
        {["bg-amber-400", "bg-yellow-400", "bg-lime-400", "bg-emerald-500", "bg-emerald-600"].map((c, i) => (
          <span key={i} className={`w-1.5 h-1.5 rounded-full ${c}`} />
        ))}
      </div>
    </div>
  );
}

function BoardPreview() {
  const cards = [
    { h: 18, c: "#ffffff" }, { h: 26, c: "#fef9c3" }, { h: 14, c: "#dbeafe" },
    { h: 22, c: "#fce7f3" }, { h: 16, c: "#ffffff" }, { h: 24, c: "#dcfce7" },
  ];
  return (
    <div
      className="h-full p-2"
      style={{ background: "linear-gradient(160deg,#fff1be 0%,#ffb199 55%,#ff8e9e 100%)" }}
    >
      <div className="grid grid-cols-3 gap-1.5 items-start">
        {cards.map((card, i) => (
          <div
            key={i}
            className="rounded-md shadow-sm px-1 pt-1"
            style={{ height: card.h * 2, backgroundColor: card.c }}
          >
            <div className="flex items-center gap-0.5 mb-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
              <span className="h-0.5 w-4 rounded bg-gray-300" />
            </div>
            <div className="h-0.5 w-full rounded bg-gray-200 mb-0.5" />
            <div className="h-0.5 w-2/3 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

function WhiteboardPreview() {
  return (
    <div
      className="h-full relative"
      style={{
        background:
          "repeating-linear-gradient(0deg,#fff,#fff 9px,#eef2f7 10px),repeating-linear-gradient(90deg,#fff,#fff 9px,#eef2f7 10px)",
      }}
    >
      <svg viewBox="0 0 200 96" className="absolute inset-0 w-full h-full">
        <path d="M18 62 C 40 18, 70 18, 88 50 S 130 80, 150 40" fill="none" stroke="#8b5cf6" strokeWidth="4" strokeLinecap="round" />
        <circle cx="160" cy="58" r="14" fill="none" stroke="#10b981" strokeWidth="3.5" />
        <rect x="28" y="66" width="30" height="18" rx="2" fill="none" stroke="#ef4444" strokeWidth="3" />
        <path d="M100 70 L 138 70" stroke="#f59e0b" strokeWidth="6" strokeLinecap="round" opacity="0.45" />
      </svg>
    </div>
  );
}

function MiniToolsPreview() {
  return (
    <div className="h-full bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center gap-3">
      {/* 룰렛 */}
      <div
        className="w-10 h-10 rounded-full border-[3px] border-white shadow"
        style={{
          background: "conic-gradient(#f97316 0 25%, #0ea5e9 0 50%, #8b5cf6 0 75%, #10b981 0 100%)",
        }}
      />
      {/* 타이머 */}
      <div className="bg-white rounded-lg shadow px-2 py-1 font-mono text-[13px] font-extrabold text-slate-700">
        03:00
      </div>
      {/* 신호등 */}
      <div className="bg-slate-700 rounded-full px-1 py-1.5 flex flex-col gap-1">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        <span className="w-2 h-2 rounded-full bg-amber-300 opacity-40" />
        <span className="w-2 h-2 rounded-full bg-emerald-400 opacity-40" />
      </div>
    </div>
  );
}

/* ── 도구 정의 ──────────────────────────────────────────────────────────── */

const TOOLS: ToolDef[] = [
  {
    key: "quiz",
    name: "라이브 퀴즈",
    description: "문제 세트로 게임을 열고 학생들이 PIN으로 입장 — 실시간 출제·속도 점수·리더보드",
    icon: Gamepad2,
    iconColor: "#7c3aed",
    href: "/tools/quiz",
    ready: true,
    preview: <QuizPreview />,
  },
  {
    key: "wordbook",
    name: "단어장",
    description: "단어 덱 만들기 + 플래시카드·4지선다·스펠 타이핑 학습, 틀린 단어 위주 반복",
    icon: BookA,
    iconColor: "#0284c7",
    href: "/tools/wordbook",
    ready: true,
    preview: <WordbookPreview />,
  },
  {
    key: "board",
    name: "보드",
    description: "담벼락에 카드 붙이기 — 이미지·유튜브·링크, 좋아요·댓글, 실시간 동시 편집",
    icon: StickyNote,
    iconColor: "#b45309",
    href: "/tools/board",
    ready: true,
    preview: <BoardPreview />,
  },
  {
    key: "whiteboard",
    name: "화이트보드",
    description: "펜·도형·텍스트로 실시간 공동 드로잉 — 판서·브레인스토밍·문제 풀이",
    icon: PenTool,
    iconColor: "#6d28d9",
    href: "/tools/whiteboard",
    ready: true,
    preview: <WhiteboardPreview />,
  },
  {
    key: "minitools",
    name: "수업 소도구",
    description: "이름 뽑기 룰렛, 모둠 자동 편성, 타이머·신호등 — 작고 빠른 것들",
    icon: Dices,
    iconColor: "#059669",
    href: "/tools/mini",
    ready: true,
    preview: <MiniToolsPreview />,
  },
];

export default function ToolsHubPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-title font-semibold">업무 및 수업 도구</h1>
        <p className="text-caption text-text-tertiary mt-1">
          수업에서 바로 쓰는 에듀테크 — 만든 것은 클래스룸 글 첨부로 가져올 수 있습니다.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const card = (
            <div
              className={`group relative h-full border border-border-default rounded-xl overflow-hidden bg-bg-primary transition ${
                t.ready
                  ? "hover:shadow-lg hover:-translate-y-0.5 hover:border-border-strong cursor-pointer"
                  : "opacity-60"
              }`}
            >
              {/* 미니 목업 미리보기 */}
              <div className="h-28 relative border-b border-border-default/60">
                {t.preview}
                {t.ready && (
                  <span
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openToolWindow(t.href);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 hover:bg-white text-gray-700 shadow-sm opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    title="새 창에서 열기"
                  >
                    <ExternalLink size={13} />
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <Icon size={16} style={{ color: t.iconColor }} className="flex-shrink-0" />
                  <div className="text-body font-semibold">{t.name}</div>
                  {!t.ready && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary border border-border-default text-text-tertiary">
                      준비 중
                    </span>
                  )}
                </div>
                <p className="text-caption text-text-secondary mt-1.5 leading-relaxed">
                  {t.description}
                </p>
              </div>
            </div>
          );
          return t.ready ? (
            <Link key={t.key} href={t.href} className="block h-full">
              {card}
            </Link>
          ) : (
            <div key={t.key} className="h-full">{card}</div>
          );
        })}
      </div>
    </div>
  );
}
