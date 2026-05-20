"use client";

/**
 * 구글 문서/시트/슬라이드 URL → iframe preview.
 *
 * 사용:
 *   <GoogleDocPreview url="https://docs.google.com/document/d/.../edit" />
 *
 * 변환 규칙:
 *   docs.google.com/document/d/{id}/...    → /document/d/{id}/preview
 *   docs.google.com/spreadsheets/d/{id}/...  → /spreadsheets/d/{id}/preview
 *   docs.google.com/presentation/d/{id}/... → /presentation/d/{id}/preview
 *   drive.google.com/file/d/{id}/...        → /file/d/{id}/preview
 *
 * URL이 위 패턴에 안 맞으면 null 반환 (호출자가 외부 링크로 fallback).
 */

import { useState } from "react";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

const PATTERNS = [
  { re: /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/, type: "document" },
  { re: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/, type: "spreadsheets" },
  { re: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/, type: "presentation" },
  { re: /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/, type: "file" },
];

export function parseGoogleDocUrl(url: string): { embedUrl: string; type: string } | null {
  for (const { re, type } of PATTERNS) {
    const m = url.match(re);
    if (m) {
      const id = m[1];
      return {
        embedUrl: `https://docs.google.com/${type === "file" ? "file" : type}/d/${id}/preview`,
        type,
      };
    }
  }
  return null;
}

export function GoogleDocPreview({
  url,
  title,
  defaultOpen = false,
}: {
  url: string;
  title?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const parsed = parseGoogleDocUrl(url);

  if (!parsed) {
    // 패턴 안 맞으면 그냥 외부 링크
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-accent hover:underline text-[13px]"
      >
        <ExternalLink size={12} /> {title || url}
      </a>
    );
  }

  return (
    <div className="border border-border-default rounded-lg overflow-hidden bg-bg-primary">
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary border-b border-border-default">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-[13px] text-text-primary hover:text-accent"
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span className="font-medium truncate max-w-[400px]">{title || "Google 문서"}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
            Google {parsed.type === "spreadsheets" ? "Sheets" : parsed.type === "presentation" ? "Slides" : "Docs"}
          </span>
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-tertiary hover:text-accent flex items-center gap-1 text-[11px]"
          title="새 탭에서 열기"
        >
          <ExternalLink size={11} /> 열기
        </a>
      </div>
      {open && (
        <iframe
          src={parsed.embedUrl}
          className="w-full"
          style={{ height: "600px", border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          title={title || "Google Doc Preview"}
        />
      )}
    </div>
  );
}
