"use client";

/**
 * 동아리 산출물 탭 — 본인이 동아리에 제출한 산출물 목록.
 *
 * 신규 등록은 동아리 페이지(활동/대회/과제)에서 수행. 여기서는 제목 수정·삭제만.
 */

import { useCallback, useEffect, useState } from "react";
import { Edit3, FileText, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import type { ClubSubmission } from "../_shared";
import { API_URL, EmptyState } from "../_shared";


export function ClubsTab() {
  const [items, setItems] = useState<ClubSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/club-submissions");
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (c: ClubSubmission) => {
    setEditingId(c.id);
    setEditTitle(c.title);
  };
  const saveEdit = async () => {
    if (!editingId) return;
    if (!editTitle.trim()) return alert("제목을 입력하세요");
    try {
      await api.put(`/api/me/club-submissions/${editingId}`, { title: editTitle });
      setItems((prev) => prev.map((p) => p.id === editingId ? { ...p, title: editTitle } : p));
      setEditingId(null);
    } catch (e: any) {
      alert(e?.detail || "수정 실패");
    }
  };
  const remove = async (c: ClubSubmission) => {
    if (!confirm(`"${c.title}" 산출물을 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/me/club-submissions/${c.id}`);
      setItems((prev) => prev.filter((p) => p.id !== c.id));
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  return (
    <div>
      <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <div className="text-caption text-orange-900">
          ⓘ 동아리 산출물은 동아리 페이지(<b>활동/대회/과제</b>)에서 새로 등록합니다. 여기서는 본인 제출 기록 확인 + 제목 수정·삭제.
        </div>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <EmptyState text="아직 동아리 산출물이 없습니다" />
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className="bg-bg-primary border border-border-default rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {editingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 px-2 py-1 text-body border border-border-default rounded"
                        autoFocus
                      />
                      <button onClick={saveEdit} className="px-2 py-1 bg-accent text-white text-caption rounded">저장</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-1 border border-border-default text-caption rounded">취소</button>
                    </div>
                  ) : (
                    <div className="text-body text-text-primary font-medium">{c.title}</div>
                  )}
                  <div className="text-caption text-text-tertiary mt-0.5">
                    {c.club_name} · {c.submission_type}
                    {c.created_at && ` · ${c.created_at.slice(0, 10)}`}
                  </div>
                </div>
                {editingId !== c.id && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(c)} className="p-1.5 text-text-tertiary hover:text-accent" title="제목 수정">
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => remove(c)} className="p-1.5 text-text-tertiary hover:text-status-error" title="삭제">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              {c.file_path && (
                <a href={`${API_URL}${c.file_path}`} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 mt-1.5 px-2 py-1 text-caption bg-bg-secondary rounded">
                  <FileText size={12} /> 파일 열기
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
