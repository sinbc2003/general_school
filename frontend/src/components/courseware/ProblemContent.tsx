"use client";

/**
 * 문제 본문 렌더링 — 마크다운 이미지 (`![alt](url)`) 자동 분리.
 *
 * 외부 마크다운 라이브러리 의존 없이 정규식으로 split:
 *  - 텍스트 부분: <span> + whitespace-pre-wrap
 *  - 이미지 부분: <img> (lazy + max-w-full)
 *
 * URL은 `/api/files/storage/courseware/...` 또는 외부 https URL 둘 다 지원.
 * 인증 필요한 storage URL은 fetch + blob 변환 — img.src에 직접 못 박음 →
 * 본 컴포넌트에서 first paint에 fetch 후 ObjectURL 캐시.
 */

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";
const IMG_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;

interface Part {
  kind: "text" | "img";
  value: string;  // text content OR raw url
  alt?: string;
}

function parseContent(content: string): Part[] {
  const parts: Part[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  IMG_PATTERN.lastIndex = 0;
  while ((m = IMG_PATTERN.exec(content)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: "text", value: content.slice(lastIndex, m.index) });
    }
    parts.push({ kind: "img", value: m[2].trim(), alt: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return parts;
}

interface AuthedImageProps {
  src: string;
  alt?: string;
}

function AuthedImage({ src, alt }: AuthedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const isAuthed = src.startsWith("/api/files/");
  const fullSrc = src.startsWith("http") ? src : `${API_URL}${src}`;

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
  const parts = parseContent(content || "");

  return (
    <div className={className ?? "text-body whitespace-pre-wrap"}>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.value}</span>
        ) : (
          <AuthedImage key={i} src={p.value} alt={p.alt} />
        ),
      )}
    </div>
  );
}
