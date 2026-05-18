"use client";

/**
 * 챗봇 메시지 한 줄 렌더.
 *
 * 사용자: 우측 베이지 박스
 * 어시스턴트: 좌측 아이콘 + Markdown(+ KaTeX) 본문, 토큰/비용 fine-print
 */

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Sparkles } from "lucide-react";
import type { Message } from "./_chat-styles";
import { C as DefaultPalette, type ChatPalette } from "./_chat-styles";

interface Props {
  message: Message;
  streaming?: boolean;
  C?: ChatPalette;
}

export function MessageBubble({ message, streaming = false, C = DefaultPalette }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className={`max-w-[80%] ${C.bgUserMsg} rounded-2xl px-4 py-2.5`}>
          <div className={`text-[15px] leading-relaxed ${C.text} whitespace-pre-wrap break-words`}>
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className={`w-8 h-8 rounded-full ${C.accent} text-white flex items-center justify-center flex-shrink-0`}>
        <Sparkles size={14} />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {message.error ? (
          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
            <div className="font-medium mb-1">⚠ 오류</div>
            <div>{message.error}</div>
          </div>
        ) : (
          <div className={`prose prose-sm max-w-none ${C.text} prose-headings:font-semibold prose-p:leading-relaxed prose-pre:bg-[#2c1810]/5 prose-code:text-[#a04e30]`}>
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code: ({ inline, children, ...props }: any) =>
                  inline ? (
                    <code className="px-1 py-0.5 rounded bg-[#2c1810]/10 text-[0.85em]" {...props}>
                      {children}
                    </code>
                  ) : (
                    <pre className="bg-[#2c1810]/5 p-3 rounded-lg overflow-x-auto text-[0.85em]">
                      <code {...props}>{children}</code>
                    </pre>
                  ),
              }}
            >
              {message.content || (streaming ? "▋" : "")}
            </ReactMarkdown>
          </div>
        )}
        {!streaming && (message.cost_usd > 0 || message.input_tokens > 0) && (
          <div className={`text-[10px] mt-2 ${C.textSubtle}`}>
            {message.model_id} · {message.input_tokens}+{message.output_tokens} tok · ${message.cost_usd.toFixed(5)}
          </div>
        )}
      </div>
    </div>
  );
}
