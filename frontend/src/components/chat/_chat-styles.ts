/**
 * 챗봇 인터페이스 공유 타입 + 색상 팔레트.
 *
 * Claude.ai 풍 warm beige 톤. ChatInterface와 sub-component (SessionGroup,
 * MessageBubble, ChatInputBox)가 함께 import.
 */

export interface Session {
  id: number;
  title: string;
  audience: string;
  provider: string;
  model_id: string;
  pinned: boolean;
  archived: boolean;
  total_cost_usd: number;
  created_at: string;
  last_message_at: string | null;
  // 강좌 챗봇으로 시작된 세션 (없으면 null). 사이드바 시각 구분에 사용.
  source_chatbot_id?: number | null;
  source_chatbot_name?: string | null;
  source_course_id?: number | null;
  source_course_name?: string | null;
}

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  provider?: string;
  model_id?: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error?: string | null;
  created_at: string;
}

export interface ModelInfo {
  id: number;
  provider: string;
  model_id: string;
  display_name: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  context_window: number | null;
  active: boolean;
}

// ─── 색상 팔레트 (Tailwind 인라인 — warm beige + claude orange) ───
export const C = {
  bg: "bg-[#faf9f5]",
  bgSidebar: "bg-[#f0eee6]",
  bgInput: "bg-white",
  bgUserMsg: "bg-[#f4e9d8]",
  bgItem: "hover:bg-[#e8e4d6]",
  bgItemActive: "bg-[#e1dcc8]",
  text: "text-[#2c1810]",
  textMuted: "text-[#5a4a3a]",
  textSubtle: "text-[#8a7a6a]",
  accent: "bg-[#c15f3c]",
  accentText: "text-[#c15f3c]",
  accentHover: "hover:bg-[#a04e30]",
  border: "border-[#e1dcc8]",
} as const;

export type ChatPalette = typeof C;
