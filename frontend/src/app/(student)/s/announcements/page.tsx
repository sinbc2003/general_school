"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Pin } from "lucide-react";
import { api } from "@/lib/api/client";

interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: "all" | "staff";
  is_pinned: boolean;
  author_name: string | null;
  created_at: string | null;
}

export default function StudentAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Announcement | null>(null);

  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      const data = await api.get(`/api/announcements?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-title text-text-primary flex items-center gap-2">
          <Megaphone size={22} className="text-accent" /> 공지사항
        </h1>
        <p className="text-caption text-text-tertiary mt-0.5">
          학교에서 전달하는 공지를 확인하세요.
        </p>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <Megaphone size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">등록된 공지가 없습니다</div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className="w-full text-left bg-bg-primary border border-border-default rounded-lg p-3 hover:border-accent transition-colors"
            >
              <div className="flex items-start gap-2">
                {a.is_pinned && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-caption rounded bg-amber-100 text-amber-700 flex-shrink-0 mt-0.5">
                    <Pin size={11} /> 고정
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium text-text-primary truncate">{a.title}</div>
                  <div className="text-caption text-text-tertiary mt-0.5">
                    {a.author_name || "(작성자 미상)"} · {a.created_at?.slice(0, 16).replace("T", " ")}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 text-caption border border-border-default rounded disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-caption text-text-secondary">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1 text-caption border border-border-default rounded disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {/* 상세 모달 */}
      {selected && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-bg-primary rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 className="text-title text-text-primary flex-1">{selected.title}</h2>
              <button onClick={() => setSelected(null)} className="text-text-tertiary hover:text-text-primary">✕</button>
            </div>
            <div className="text-caption text-text-tertiary mb-4">
              {selected.author_name || "(작성자 미상)"} · {selected.created_at?.slice(0, 16).replace("T", " ")}
            </div>
            <div className="text-body text-text-primary whitespace-pre-wrap">{selected.body}</div>
          </div>
        </div>
      )}
    </div>
  );
}
