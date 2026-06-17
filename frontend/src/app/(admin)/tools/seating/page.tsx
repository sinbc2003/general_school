"use client";

/** 자리배치 목록 — 저장된 자리표 카드 + 새로 만들기. */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft, Armchair, Plus, Trash2, ExternalLink, Loader2, Pencil,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { openToolWindow } from "@/lib/open-tool-window";
import { defaultLayout, emptyConstraints } from "./_shared";

interface ChartItem {
  id: number;
  title: string;
  roster_count: number;
  updated_at: string | null;
}

export default function SeatingListPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-text-tertiary">불러오는 중...</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const search = useSearchParams();
  const [items, setItems] = useState<ChartItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const handledEdit = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get<{ items: ChartItem[] }>("/api/tools/seating");
      setItems(res.items);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // 드라이브 ‘열기/이름 바꾸기’ 등이 ?edit=ID 로 진입 → 편집기로 이동
  useEffect(() => {
    const editId = search.get("edit");
    if (editId && editId !== handledEdit.current) {
      handledEdit.current = editId;
      router.replace(`/tools/seating/${editId}`);
    }
  }, [search, router]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await api.post<{ id: number }>("/api/tools/seating", {
        title: title.trim() || "새 자리표",
        layout: defaultLayout(),
        roster: [],
        constraints: emptyConstraints(),
      });
      router.push(`/tools/seating/${res.id}`);
    } catch (e: any) {
      alert(e?.detail || "생성 실패");
      setCreating(false);
    }
  };

  const remove = async (e: React.MouseEvent, item: ChartItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`'${item.title}'을(를) 휴지통으로 옮길까요?`)) return;
    try {
      await api.delete(`/api/tools/seating/${item.id}`);
      setItems((prev) => prev?.filter((x) => x.id !== item.id) ?? null);
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <Link href="/tools" className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary">
          <ChevronLeft size={14} /> 도구 모음
        </Link>
        <button
          onClick={() => openToolWindow("/tools/seating")}
          className="inline-flex items-center gap-1 px-3 py-1.5 border border-border-default rounded-lg text-caption text-text-secondary hover:bg-bg-secondary"
        >
          <ExternalLink size={13} /> 새 창
        </button>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title font-semibold flex items-center gap-2">
          <Armchair size={22} className="text-teal-600" /> 자리배치
        </h1>
        <button
          onClick={() => { setNewOpen(true); setTitle(""); }}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-body font-medium"
        >
          <Plus size={16} /> 새 자리표
        </button>
      </div>

      {items === null ? (
        <div className="py-12 text-center text-text-tertiary"><Loader2 className="animate-spin inline" /></div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-border-default rounded-xl">
          <Armchair size={32} className="mx-auto text-text-tertiary/40 mb-3" />
          <p className="text-body text-text-secondary">아직 만든 자리표가 없습니다.</p>
          <p className="text-caption text-text-tertiary mt-1">‘새 자리표’로 교실을 만들고 명단을 불러오세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/tools/seating/${item.id}`}
              className="group relative block border border-border-default rounded-xl p-4 bg-bg-primary hover:shadow-md hover:border-border-strong transition"
            >
              <div className="flex items-start gap-2">
                <Armchair size={18} className="text-teal-600 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-body font-semibold truncate">{item.title}</div>
                  <div className="text-caption text-text-tertiary mt-0.5">
                    학생 {item.roster_count}명
                    {item.updated_at && ` · ${new Date(item.updated_at).toLocaleDateString("ko-KR")}`}
                  </div>
                </div>
              </div>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <span className="p-1.5 rounded-full bg-white shadow-sm text-gray-600" title="열기"><Pencil size={13} /></span>
                <button onClick={(e) => remove(e, item)} className="p-1.5 rounded-full bg-white shadow-sm text-rose-600 hover:bg-rose-50" title="휴지통으로">
                  <Trash2 size={13} />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}

      {newOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !creating && setNewOpen(false)}>
          <div className="bg-bg-primary rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-body font-semibold mb-3">새 자리표</h2>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
              placeholder="예: 2학년 3반 6월 자리"
              className="w-full px-3 py-2 border border-border-default rounded-lg text-body outline-none focus:border-teal-500"
            />
            <p className="text-caption text-text-tertiary mt-2">기본 교실(5줄 × 3열 2인 책상)로 시작합니다. 만든 뒤 자유롭게 바꿀 수 있어요.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setNewOpen(false)} disabled={creating} className="px-4 py-2 rounded-lg border border-border-default text-body hover:bg-bg-secondary">취소</button>
              <button onClick={create} disabled={creating} className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-body">
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
