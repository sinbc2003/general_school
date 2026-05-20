/**
 * 프리젠테이션 디자인 테마 — PPT 019 프로젝트의 8종을 web 슬라이드 CSS로 변환.
 *
 * 작동 방식 차이:
 *   - PPT 019: python-pptx로 .pptx 파일 생성 (정적 export)
 *   - 우리: web 동적 슬라이드 (CSS 적용)
 *
 * 가져온 것: 각 디자인의 색·폰트·배경·accent 톤만. 레이아웃·전환은 web 한정.
 *
 * 사용:
 *   const theme = THEMES.find(t => t.id === deck.settings.theme_id) ?? THEMES[0];
 *   <div style={theme.slideStyle}>...</div>
 */

import { type CSSProperties } from "react";

export interface DeckTheme {
  id: string;
  label: string;
  desc: string;
  /** 미리보기 색상 (palette swatch — 4색) */
  swatch: string[];
  /** slide 본문 컨테이너에 적용할 인라인 style */
  slideStyle: CSSProperties;
  /** 본문 .prose 색상·폰트 override (Tailwind prose 기반 보강) */
  contentClass?: string;
  /** 본문 inline style (heading·텍스트·강조 등 통합 색) */
  contentStyle?: CSSProperties;
  /** accent 색 — caret·하이라이트·강조 박스 */
  accent: string;
  /** subtle 라인 (좌측 bar 등) */
  decoration?: "left-bar" | "top-stripe" | "grid" | "lines" | "none";
}

export const THEMES: DeckTheme[] = [
  {
    id: "minimal",
    label: "Minimal",
    desc: "흰 배경 · 옅은 회색 · 산세리프",
    swatch: ["#ffffff", "#f3f4f6", "#6b7280", "#111827"],
    slideStyle: {
      backgroundColor: "#ffffff",
      color: "#111827",
      fontFamily: "ui-sans-serif, 'Noto Sans KR', system-ui, sans-serif",
    },
    accent: "#374151",
    decoration: "none",
  },
  {
    id: "monochrome",
    label: "Monochrome",
    desc: "회색 톤 · 면 채움 없음 · 라인만",
    swatch: ["#f9fafb", "#d1d5db", "#6b7280", "#1f2937"],
    slideStyle: {
      backgroundColor: "#f9fafb",
      color: "#1f2937",
      fontFamily: "ui-sans-serif, 'Noto Sans KR', system-ui, sans-serif",
      borderTop: "3px solid #6b7280",
    },
    accent: "#4b5563",
    decoration: "top-stripe",
  },
  {
    id: "seminar",
    label: "Seminar",
    desc: "네이비 + 앰버 · 학술 발표",
    swatch: ["#1E3A5F", "#D97706", "#FCD34D", "#ffffff"],
    slideStyle: {
      backgroundColor: "#ffffff",
      color: "#1E3A5F",
      fontFamily: "'Malgun Gothic', ui-sans-serif, 'Noto Sans KR', sans-serif",
      borderLeft: "8px solid #1E3A5F",
    },
    accent: "#D97706",
    decoration: "left-bar",
  },
  {
    id: "academic",
    label: "Academic",
    desc: "짙은 청 · 명조 · 차분한 학술 톤",
    swatch: ["#fafaf9", "#1e293b", "#475569", "#0f172a"],
    slideStyle: {
      backgroundColor: "#fafaf9",
      color: "#0f172a",
      fontFamily: "ui-serif, 'Noto Serif KR', 'Batang', serif",
    },
    accent: "#1e293b",
    decoration: "none",
  },
  {
    id: "vivid",
    label: "Vivid",
    desc: "선명한 그라데이션 · 큰 글씨",
    swatch: ["#fb923c", "#f43f5e", "#a855f7", "#ffffff"],
    slideStyle: {
      background: "linear-gradient(135deg, #fb923c 0%, #f43f5e 50%, #a855f7 100%)",
      color: "#ffffff",
      fontFamily: "ui-sans-serif, 'Noto Sans KR', system-ui, sans-serif",
    },
    accent: "#fde047",
    decoration: "none",
  },
  {
    id: "blackboard",
    label: "Blackboard",
    desc: "검은 칠판 · 분필 글씨",
    swatch: ["#1a1a1a", "#374151", "#fde047", "#f9fafb"],
    slideStyle: {
      backgroundColor: "#1a2e1a",
      color: "#f9fafb",
      fontFamily: "'Caveat', 'Nanum Pen Script', cursive",
      backgroundImage:
        "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), " +
        "linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
      backgroundSize: "30px 30px",
    },
    accent: "#fde047",
    decoration: "none",
  },
  {
    id: "notebook",
    label: "Notebook",
    desc: "노트 종이 · 가로줄",
    swatch: ["#fffbeb", "#fde68a", "#3b82f6", "#1e3a8a"],
    slideStyle: {
      backgroundColor: "#fffbeb",
      color: "#1e3a8a",
      fontFamily: "'Caveat', 'Nanum Pen Script', cursive",
      backgroundImage:
        "repeating-linear-gradient(transparent, transparent 35px, rgba(59,130,246,0.18) 35px, rgba(59,130,246,0.18) 36px)",
      borderLeft: "3px solid #f43f5e",
    },
    accent: "#3b82f6",
    decoration: "lines",
  },
  {
    id: "modern_grid",
    label: "Modern Grid",
    desc: "옅은 그리드 + 강한 액센트",
    swatch: ["#0f172a", "#334155", "#22d3ee", "#f1f5f9"],
    slideStyle: {
      backgroundColor: "#0f172a",
      color: "#f1f5f9",
      fontFamily: "'Inter', ui-sans-serif, 'Noto Sans KR', sans-serif",
      backgroundImage:
        "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), " +
        "linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
      backgroundSize: "40px 40px",
    },
    accent: "#22d3ee",
    decoration: "grid",
  },
];

export const DEFAULT_THEME_ID = "minimal";

export function getTheme(id?: string | null): DeckTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
