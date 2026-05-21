// Google Forms 식 차트 색상 팔레트
// 응답 분포 색상이 순환되도록 정의.
export const CHART_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#a855f7", // purple
];

export const ACCENT = "#673ab7"; // Google Forms 보라

export function colorAt(idx: number): string {
  return CHART_COLORS[idx % CHART_COLORS.length];
}
