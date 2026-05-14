"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pin, PinOff, Edit3, Trash2, Megaphone, X, Save, Users, Shield } from "lucide-react";
import { api } from "@/lib/api/client";

interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: "all" | "staff";
  is_pinned: boolean;
  author_id: number | null;
  author_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  can_edit: boolean;
}

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [audienceFilter, setAudienceFilter] = useState<"" | "all" | "staff">("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: "",
    body: "",
    audience: "all" as "all" | "staff",
    is_pinned: false,
  });
  const [saving, setSaving] = useState(false);

  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (audienceFilter) params.set("audience", audienceFilter);
      const data = await api.get(`/api/announcements?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, audienceFilter]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ title: "", body: "", audience: "all", is_pinned: false });
    setEditingId(null);
    setShowForm(false);
  };

  const startCreate = () => { resetForm(); setShowForm(true); };

  const startEdit = (a: Announcement) => {
    setForm({ title: a.title, body: a.body, audience: a.audience, is_pinned: a.is_pinned });
    setEditingId(a.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title.trim()) return alert("제목을 입력하세요");
    if (!form.body.trim()) return alert("본문을 입력하세요");
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/announcements/${editingId}`, form);
      } else {
        await api.post("/api/announcements", form);
      }
      resetForm();
      await load();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Announcement) => {
    if (!confirm(`"${a.title}" 공지를 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/announcements/${a.id}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const togglePin = async (a: Announcement) => {
    try {
      await api.put(`/api/announcements/${a.id}`, { is_pinned: !a.is_pinned });
      await load();
    } catch (e: any) {
      alert(e?.detail || "변경 실패");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <Megaphone size={22} className="text-accent" /> 공지사항
          </h1>
          <p className="text-caption text-text-tertiary mt-0.5">
            교사·관리자가 작성. 대상은 <b>모두 (학생 포함)</b> 또는 <b>교직원 전용</b>으로 선택.
          </p>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 px-3 py-2 bg-accent text-white text-body rounded hover:bg-accent-hover"
        >
          <Plus size={14} /> 공지 작성
        </button>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-caption text-text-secondary">대상 필터:</span>
        {[
          { key: "", label: "전체" },
          { key: "all", label: "모두 (학생 포함)" },
          { key: "staff", label: "교직원 전용" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => { setAudienceFilter(f.key as any); setPage(1); }}
            className={`px-3 py-1 text-caption rounded ${
              audienceFilter === f.key ? "bg-accent text-white" : "bg-bg-primary border border-border-default"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-caption text-text-tertiary">총 {total}건</span>
      </div>

      {/* 작성/수정 폼 */}
      {showForm && (
        <div className="mb-4 bg-bg-primary border border-accent rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-body font-semibold">{editingId ? "공지 수정" : "새 공지 작성"}</h2>
            <button onClick={resetForm}><X size={16} /></button>
          </div>
          <div className="space-y-3">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="제목"
              className="w-full px-3 py-2 border border-border-default rounded text-body"
              maxLength={200}
            />
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="본문 (줄바꿈 그대로 표시됨)"
              rows={8}
              className="w-full px-3 py-2 border border-border-default rounded text-body resize-y"
            />
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-caption text-text-secondary">노출 대상:</span>
                <label className="flex items-center gap-1 text-body">
                  <input
                    type="radio" name="audience"
                    checked={form.audience === "all"}
                    onChange={() => setForm({ ...form, audience: "all" })}
                  />
                  <Users size={13} /> 모두 (학생 포함)
                </label>
                <label className="flex items-center gap-1 text-body">
                  <input
                    type="radio" name="audience"
                    checked={form.audience === "staff"}
                    onChange={() => setForm({ ...form, audience: "staff" })}
                  />
                  <Shield size={13} /> 교직원 전용
                </label>
              </div>
              <label className="flex items-center gap-1 text-body">
                <input
                  type="checkbox"
                  checked={form.is_pinned}
                  onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })}
                />
                <Pin size={13} /> 상단 고정
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={save} disabled={saving}
                className="flex items-center gap-1 px-4 py-2 bg-accent text-white text-body rounded hover:bg-accent-hover disabled:opacity-50"
              >
                <Save size={14} /> {saving ? "저장 중..." : "저장"}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 border border-border-default rounded text-body"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <Megaphone size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">등록된 공지가 없습니다</div>
          <button onClick={startCreate} className="mt-3 px-3 py-1.5 bg-accent text-white rounded text-caption">
            첫 공지 작성
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className="bg-bg-primary border border-border-default rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {a.is_pinned && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-caption rounded bg-amber-100 text-amber-700">
                        <Pin size={11} /> 고정
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-caption rounded ${
                        a.audience === "staff" ? "bg-purple-100 text-purple-700" : "bg-cream-200 text-blue-700"
                      }`}
                    >
                      {a.audience === "staff" ? <><Shield size={11} /> 교직원 전용</> : <><Users size={11} /> 모두</>}
                    </span>
                    <span className="text-caption text-text-tertiary">
                      {a.author_name || "(작성자 미상)"} · {a.created_at?.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  <h3 className="text-body font-semibold text-text-primary truncate">{a.title}</h3>
                  <p className="text-caption text-text-secondary mt-1 whitespace-pre-wrap line-clamp-3">{a.body}</p>
                </div>
                {a.can_edit && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => togglePin(a)}
                      className="p-1.5 text-text-tertiary hover:text-amber-600"
                      title={a.is_pinned ? "고정 해제" : "상단 고정"}
                    >
                      {a.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button
                      onClick={() => startEdit(a)}
                      className="p-1.5 text-text-tertiary hover:text-accent"
                      title="수정"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(a)}
                      className="p-1.5 text-text-tertiary hover:text-status-error"
                      title="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 text-caption border border-border-default rounded disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1 text-caption border border-border-default rounded disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
