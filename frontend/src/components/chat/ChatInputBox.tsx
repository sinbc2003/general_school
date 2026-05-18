"use client";

/**
 * 챗봇 입력창 — textarea + 전송/중단 버튼.
 *
 * Enter로 전송 (Shift+Enter 줄바꿈). 스트리밍 중에는 전송 버튼이 중단 버튼으로 토글.
 */

import type { RefObject } from "react";
import { ArrowUp, Square } from "lucide-react";
import { C as DefaultPalette, type ChatPalette } from "./_chat-styles";

interface Props {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => void;
  streaming: boolean;
  stopStream: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
  placeholder?: string;
  C?: ChatPalette;
}

export function ChatInputBox({
  input, setInput, sendMessage, streaming, stopStream, inputRef, placeholder,
  C = DefaultPalette,
}: Props) {
  return (
    <div className={`relative ${C.bgInput} border ${C.border} rounded-3xl shadow-sm overflow-hidden`}>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        }}
        placeholder={placeholder}
        rows={1}
        disabled={streaming}
        className={`w-full px-5 pt-4 pb-12 text-[15px] resize-none bg-transparent focus:outline-none ${C.text} placeholder:${C.textSubtle}`}
        style={{ minHeight: "60px" }}
      />
      <div className="absolute bottom-2 right-2">
        {streaming ? (
          <button
            onClick={stopStream}
            className={`w-9 h-9 ${C.accent} text-white rounded-full flex items-center justify-center hover:bg-[#a04e30] shadow-sm`}
            title="중단"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className={`w-9 h-9 ${C.accent} text-white rounded-full flex items-center justify-center disabled:opacity-30 hover:bg-[#a04e30] shadow-sm transition-opacity`}
            title="전송"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
