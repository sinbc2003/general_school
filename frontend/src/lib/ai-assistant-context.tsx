"use client";

/**
 * AI 도우미 패널(`AIAssistantPanel`)의 열림 상태 전역 공유.
 *
 * - admin layout의 main이 이 상태에 따라 우측 padding을 추가 → 본문이
 *   panel과 겹치지 않고 옆으로 밀려남.
 * - panel 자체는 여전히 fixed 우측 0으로 화면에 고정.
 */

import { createContext, useContext, useState } from "react";

interface AIAssistantContextValue {
  open: boolean;
  panelWidth: number;
  setOpen: (v: boolean) => void;
  setPanelWidth: (n: number) => void;
}

const AIAssistantContext = createContext<AIAssistantContextValue>({
  open: false,
  panelWidth: 380,
  setOpen: () => {},
  setPanelWidth: () => {},
});

export const useAIAssistant = () => useContext(AIAssistantContext);

export function AIAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(380);
  return (
    <AIAssistantContext.Provider value={{ open, panelWidth, setOpen, setPanelWidth }}>
      {children}
    </AIAssistantContext.Provider>
  );
}
