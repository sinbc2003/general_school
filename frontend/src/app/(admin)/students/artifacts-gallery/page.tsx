"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase, FileText, ExternalLink, Search, Filter } from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

const CATS: Record<string, string> = {
  report: "보고서/논문", presentation: "발표자료",
  project: "프로젝트", media: "이미지/영상", other: "기타",
};

interface Artifact {
  id: number;
  title: string;
  description: string | null;
  category: string;
  file_url: string | null;
  external_link: string | null;
  tags: string[];
  is_public: boolean;
  created_at: string | null;
  student_id: number;
  student_name: string;
  student_class: string;
}

export default function ArtifactsGalleryPage() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (keyword) params.set("keyword", keyword);
      if (category !== "all") params.set("category", category);
      const data = await api.get(`/api/students/_io/artifacts/public?${params}`);
      setItems(data.items || []);
    } catch (e: any) {
      console.error(e);
      setItems([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [category]);

  return (
    <div className="max-w-6xl">
      <Link href="/students" className="flex items-center gap-1 text-caption text-text-secondary hover:text-accent mb-3">
        <ArrowLeft size={14} /> 학생 현황으로
      </Link>
      <h1 className="text-title text-text-primary mb-1">공개 산출물 갤러리</h1>
      <p className="text-caption text-text-tertiary mb-6">
        학생들이 직접 업로드하고 공개로 설정한 산출물(보고서·발표자료·프로젝트·미디어 등)을 한 곳에서 봅니다.
        비공개 산출물은 해당 학생의 상세 페이지 "산출물" 탭에서 별도 조회.
      </p>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <Search size={16} className="text-text-tertiary" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="제목 검색 (Enter)"
            className="flex-1 px-3 py-1.5 text-body border border-border-default rounded"
          />
          <button onClick={load} className="px-3 py-1.5 bg-accent text-white text-caption rounded">검색</button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setCategory("all")}
            className={`px-3 py-1 text-caption rounded ${category === "all" ? "bg-accent text-white" : "bg-bg-secondary"}`}
          >전체</button>
          {Object.entries(CATS).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setCategory(k)}
              className={`px-3 py-1 text-caption rounded ${category === k ? "bg-accent text-white" : "bg-bg-secondary"}`}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* 갤러리 */}
      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-text-tertiary border-2 border-dashed border-border-default rounded-lg">
          공개된 산출물이 없습니다
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((a) => (
            <div key={a.id} className="bg-bg-primary border border-border-default rounded-lg p-4">
              <div className="flex items-start gap-2 mb-2">
                <Briefcase size={14} className="text-accent mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium truncate">{a.title}</div>
                  <div className="text-caption text-text-tertiary">
                    {CATS[a.category] || a.category} · {(a.created_at || "").slice(0, 10)}
                  </div>
                </div>
              </div>
              <Link href={`/students?id=${a.student_id}`}
                    className="inline-block text-caption text-accent hover:underline mb-2">
                {a.student_name} ({a.student_class})
              </Link>
              {a.description && (
                <div className="text-caption text-text-secondary mb-2 line-clamp-3">{a.description}</div>
              )}
              {(a.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {a.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 bg-bg-secondary text-caption rounded">#{t}</span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t border-border-default">
                {a.file_url && (
                  <a href={`${API_URL}${a.file_url}`} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1 px-2 py-1 text-caption bg-bg-secondary rounded hover:bg-accent-light">
                    <FileText size={12} /> 파일
                  </a>
                )}
                {a.external_link && (
                  <a href={a.external_link} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1 px-2 py-1 text-caption bg-bg-secondary rounded hover:bg-accent-light">
                    <ExternalLink size={12} /> 링크
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
