/**
 * 강좌별 배너 색상 — course_id 기반 결정적 매핑.
 *
 * Google Classroom과 유사하게 7~8개 톤 중 하나. 같은 강좌는 항상 같은 색.
 */

export interface CourseTone {
  /** 배너 배경 (메인) */
  bg: string;
  /** 배너 텍스트 (흰 또는 어두운 톤) */
  fg: string;
  /** 탭 underline 활성색 (배너와 어울리는 강한 색) */
  accent: string;
}

const PALETTE: CourseTone[] = [
  { bg: "#fb923c", fg: "#fff", accent: "#ea580c" }, // 오렌지
  { bg: "#60a5fa", fg: "#fff", accent: "#2563eb" }, // 파랑
  { bg: "#34d399", fg: "#0f3528", accent: "#059669" }, // 청록
  { bg: "#a78bfa", fg: "#fff", accent: "#7c3aed" }, // 보라
  { bg: "#f472b6", fg: "#fff", accent: "#db2777" }, // 분홍
  { bg: "#fbbf24", fg: "#3d2c00", accent: "#d97706" }, // 노랑
  { bg: "#22d3ee", fg: "#062a35", accent: "#0891b2" }, // 시안
  { bg: "#94a3b8", fg: "#fff", accent: "#475569" }, // 그레이 (대체)
];

export function getCourseTone(courseId: number): CourseTone {
  // 결정적 hash — Math.abs로 음수 회피
  const i = Math.abs(courseId * 2654435761) % PALETTE.length;
  return PALETTE[i];
}
