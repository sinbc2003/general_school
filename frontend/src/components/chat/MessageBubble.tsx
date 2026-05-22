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
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import "katex/dist/katex.min.css";

// rehype-sanitize default schema에 KaTeX 출력(MathML/span class) 허용 추가.
// LLM 응답이 직접 HTML/script를 끼워넣지 못하게 차단하면서 수식 렌더는 유지.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span || []), ["className"]],
    div: [...(defaultSchema.attributes?.div || []), ["className"]],
    code: [...(defaultSchema.attributes?.code || []), ["className"]],
    "*": [...(defaultSchema.attributes?.["*"] || []), "style"],
  },
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // KaTeX MathML 태그
    "math", "mrow", "mi", "mo", "mn", "msup", "msub", "msubsup", "mfrac",
    "msqrt", "mroot", "mtext", "mspace", "mover", "munder", "munderover",
    "mtable", "mtr", "mtd", "annotation", "semantics", "mstyle",
    "menclose", "mphantom", "mpadded", "mfenced", "mlongdiv", "mscarries",
    "mscarry", "msgroup", "msline", "msrow", "mstack",
  ],
};
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
              rehypePlugins={[rehypeKatex, [rehypeSanitize, sanitizeSchema]]}
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
