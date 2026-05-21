"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus, X, Award, FileText, MessageSquare, BarChart3, BookOpen,
  Notebook, Briefcase, Target, Eye, Globe, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { downloadSecure } from "@/lib/api/download";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export function ArtifactsTab({ studentId }: { studentId: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    api.get(`/api/students/${studentId}/artifacts`)
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [studentId]);

  const CATS: Record<string, string> = {
    report: "보고서/논문", presentation: "발표자료",
    project: "프로젝트", media: "이미지/영상", other: "기타",
  };

  const filtered = filter === "all" ? items : items.filter((a) => a.category === filter);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-body text-text-secondary">전체 {items.length}건</span>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter("all")}
            className={`px-2 py-1 text-caption rounded ${filter === "all" ? "bg-accent text-white" : "bg-bg-secondary"}`}
          >전체</button>
          {Object.entries(CATS).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-2 py-1 text-caption rounded ${filter === k ? "bg-accent text-white" : "bg-bg-secondary"}`}
            >{label}</button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="py-8 text-center text-text-tertiary border-2 border-dashed border-border-default rounded-lg">
          학생이 등록한 산출물이 없습니다
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((a) => (
            <div key={a.id} className="bg-bg-primary border border-border-default rounded-lg p-3">
              <div className="flex items-start gap-2 mb-2">
                <Briefcase size={14} className="text-accent mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium truncate">{a.title}</div>
                  <div className="text-caption text-text-tertiary">
                    {CATS[a.category] || a.category} · {(a.created_at || "").slice(0, 10)}
                  </div>
                </div>
                {a.is_public && <span className="text-caption px-2 py-0.5 bg-accent-light text-accent rounded">공개</span>}
              </div>
              {a.description && <div className="text-caption text-text-secondary mb-2 line-clamp-2">{a.description}</div>}
              {(a.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {a.tags.map((t: string) => (
                    <span key={t} className="px-2 py-0.5 bg-bg-secondary text-caption rounded">#{t}</span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t border-border-default">
                {a.file_url && (
                  <button
                    onClick={() => downloadSecure(a.file_url, a.file_name)}
                    className="flex items-center gap-1 px-2 py-1 text-caption bg-bg-secondary rounded hover:bg-accent-light"
                  >
                    <FileText size={12} /> 파일
                  </button>
                )}
                {a.external_link && (
                  <a href={a.external_link} target="_blank" rel="noopener"
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


// ── Career Tab (학생 본인 진로 설계 — 교사 조회) ──
