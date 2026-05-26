"use client";

/**
 * 문제 본문 렌더링 — LaTeX 수식 + 마크다운 이미지 자동 split.
 *
 * 매칭 우선순위 (정규식 alternation 순서):
 *  1. block math `$$...$$`            → katex displayMode
 *  2. inline math `$...$`             → katex inline
 *  3. markdown image `![alt](url)`   → AuthedImage (인증된 storage URL은 blob)
 *  4. 나머지 → plain text (whitespace-pre-wrap)
 *
 * KaTeX 실패 시 raw text fallback (수식 오타 등으로 전체 렌더가 깨지지 않음).
 */

import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ImageOff } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

// alternation — block math 먼저, 그다음 image (inline math보다 우선해서 $...$
// 안에 ![]() 잘못 매칭되는 케이스 회피), 마지막에 inline math.
const TOKEN_PATTERN =
  /(\$\$[\s\S]+?\$\$|!\[[^\]]*\]\([^)]+\)|\$[^$\n]+?\$)/g;

type Token =
  | { kind: "text"; value: string }
  | { kind: "math-block"; tex: string }
  | { kind: "math-inline"; tex: string }
  | { kind: "img"; src: string; alt: string };

function tokenize(content: string): Token[] {
  const out: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const regex = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
  while ((m = regex.exec(content)) !== null) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", value: content.slice(lastIndex, m.index) });
    }
    const raw = m[0];
    if (raw.startsWith("$$")) {
      out.push({ kind: "math-block", tex: raw.slice(2, -2).trim() });
    } else if (raw.startsWith("![")) {
      const imgMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(raw);
      if (imgMatch) {
        out.push({ kind: "img", src: imgMatch[2].trim(), alt: imgMatch[1] });
      } else {
        out.push({ kind: "text", value: raw });
      }
    } else if (raw.startsWith("$")) {
      out.push({ kind: "math-inline", tex: raw.slice(1, -1).trim() });
    } else {
      out.push({ kind: "text", value: raw });
    }
    lastIndex = m.index + raw.length;
  }
  if (lastIndex < content.length) {
    out.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return out;
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode,
      strict: "ignore",
    });
  } catch {
    return tex;  // fallback
  }
}


interface AuthedImageProps {
  src: string;
  alt?: string;
}

function AuthedImage({ src, alt }: AuthedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const isAuthed = src.startsWith("/api/files/");
  const isExternal = src.startsWith("http") || src.startsWith("data:");
  const fullSrc = isExternal ? src : `${API_URL}${src}`;

  useEffect(() => {
    if (!isAuthed) return;
    let revoke: string | null = null;
    const fetchImage = async () => {
      try {
        const token = localStorage.getItem("access_token");
        const res = await fetch(fullSrc, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revoke = url;
        setObjectUrl(url);
      } catch {
        setError(true);
      }
    };
    fetchImage();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [fullSrc, isAuthed]);

  if (error) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 border border-red-200 rounded text-caption text-red-700">
        <ImageOff size={12} /> 이미지 로드 실패
      </span>
    );
  }

  if (isAuthed && !objectUrl) {
    return (
      <span className="inline-block w-32 h-20 bg-bg-secondary border border-border-default rounded animate-pulse" />
    );
  }

  return (
    <img
      src={isAuthed ? (objectUrl ?? "") : fullSrc}
      alt={alt || ""}
      loading="lazy"
      className="max-w-full h-auto inline-block rounded border border-border-default my-1"
      onError={() => setError(true)}
    />
  );
}

interface Props {
  content: string;
  className?: string;
}

export function ProblemContent({ content, className }: Props) {
  const tokens = useMemo(() => tokenize(content || ""), [content]);

  return (
    <div className={className ?? "text-body whitespace-pre-wrap"}>
      {tokens.map((t, i) => {
        if (t.kind === "text") return <span key={i}>{t.value}</span>;
        if (t.kind === "img") return <AuthedImage key={i} src={t.src} alt={t.alt} />;
        if (t.kind === "math-inline") {
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{ __html: renderMath(t.tex, false) }}
            />
          );
        }
        // math-block
        return (
          <div
            key={i}
            className="my-2"
            dangerouslySetInnerHTML={{ __html: renderMath(t.tex, true) }}
          />
        );
      })}
    </div>
  );
}

/**
 * 짧은 문자열 (객관식 보기, 정답 등) 안의 inline math만 렌더.
 *
 * 이미지는 거의 없으니 image split은 생략 — math만 처리해 가벼움.
 */
export function InlineMathText({ text }: { text: string }) {
  const tokens = useMemo(() => {
    const out: { kind: "t" | "m"; v: string }[] = [];
    let last = 0;
    const re = /\$([^$\n]+?)\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ kind: "t", v: text.slice(last, m.index) });
      out.push({ kind: "m", v: m[1].trim() });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ kind: "t", v: text.slice(last) });
    return out;
  }, [text]);

  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "t" ? (
          <span key={i}>{t.v}</span>
        ) : (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: renderMath(t.v, false) }}
          />
        ),
      )}
    </>
  );
}
