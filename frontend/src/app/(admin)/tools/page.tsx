"use client";

/**
 * 업무 및 수업 도구 허브 — 에듀테크 자체 구현 도구 카드 그리드.
 *
 * 도구 추가 시 TOOLS 배열에 항목만 추가하면 카드 자동 노출.
 * (ready=false면 "준비 중" 비활성 카드)
 */

import Link from "next/link";
import { Gamepad2, BookA, StickyNote, Dices, ExternalLink, type LucideIcon } from "lucide-react";

interface ToolDef {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  href: string;
  ready: boolean;
  accent: string; // tailwind gradient classes
}

const TOOLS: ToolDef[] = [
  {
    key: "quiz",
    name: "라이브 퀴즈",
    description: "문제 세트로 게임을 열고 학생들이 PIN으로 입장 — 실시간 출제·속도 점수·리더보드",
    icon: Gamepad2,
    href: "/tools/quiz",
    ready: true,
    accent: "from-violet-500 to-fuchsia-500",
  },
  {
    key: "wordbook",
    name: "단어장",
    description: "단어 덱 만들기 + 플래시카드·4지선다·스펠 타이핑 학습, 틀린 단어 위주 반복",
    icon: BookA,
    href: "/tools/wordbook",
    ready: true,
    accent: "from-sky-500 to-cyan-500",
  },
  {
    key: "board",
    name: "보드",
    description: "담벼락에 포스트잇 카드 붙이기 — 학급 전체 실시간 동시 편집",
    icon: StickyNote,
    href: "/tools/board",
    ready: true,
    accent: "from-amber-500 to-orange-500",
  },
  {
    key: "minitools",
    name: "수업 소도구",
    description: "이름 뽑기 룰렛, 모둠 자동 편성, 타이머·신호등 — 작고 빠른 것들",
    icon: Dices,
    href: "/tools/mini",
    ready: true,
    accent: "from-emerald-500 to-teal-500",
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
                  ? "hover:shadow-md hover:border-border-strong cursor-pointer"
                  : "opacity-60"
              }`}
            >
              <div className={`h-20 bg-gradient-to-br ${t.accent} flex items-center px-5 relative`}>
                <Icon size={32} className="text-white/95" />
                {t.ready && (
                  <span
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(t.href, "_blank", "noopener");
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-white/25 hover:bg-white/45 text-white opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    title="새 창에서 열기"
                  >
                    <ExternalLink size={13} />
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2">
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
