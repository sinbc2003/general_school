"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Star } from "lucide-react";
import { api } from "@/lib/api/client";

interface Prompt {
  id: number;
  name: string;
  audience: "teacher" | "student" | "both";
  content: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export default function LLMPromptsPage() {
  const [items, setItems] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const data = await api.get("/api/chatbot/prompts");
    setItems(data.items);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    if (editing.id < 0) {
      await api.post("/api/chatbot/prompts", editing);
    } else {
      await api.put(`/api/chatbot/prompts/${editing.id}`, editing);
    }
    setEditing(null);
    await load();
  };

  const remove = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await api.delete(`/api/chatbot/prompts/${id}`);
    await load();
  };

  const filtered = filter === "all" ? items : items.filter((p) => p.audience === filter);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-title text-text-primary">시스템 프롬프트</h1>
          <button
            onClick={() => setEditing({
              id: -1, name: "", audience: "teacher", content: "",
              is_default: false, is_active: true, sort_order: 100,
            })}
            className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-caption rounded"
          >
            <Plus size={14} /> 새 프롬프트
          </button>
        </div>
        <div className="flex gap-1 mb-4">
          {["all", "teacher", "student", "both"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-caption rounded ${filter === f ? "bg-accent text-white" : "bg-bg-secondary"}`}
            >
              {f === "all" ? "전체" : f === "teacher" ? "교사" : f === "student" ? "학생" : "공통"}
            </button>
          ))}
        </div>

        {loading ? (
          <div>로딩 중...</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => setEditing({ ...p })}
                className={`p-3 bg-bg-primary border rounded-lg cursor-pointer hover:bg-bg-secondary ${
                  editing?.id === p.id ? "border-accent" : "border-border-default"
                }`}
              >
                <div className="flex items-center gap-2">
                  {p.is_default && <Star size={12} className="text-accent fill-accent" />}
                  <span className="text-body font-medium">{p.name}</span>
                  <span className="px-2 py-0.5 bg-bg-secondary text-caption rounded">
                    {p.audience === "teacher" ? "교사" : p.audience === "student" ? "학생" : "공통"}
                  </span>
                  {!p.is_active && <span className="text-caption text-text-tertiary">(비활성)</span>}
                </div>
                <div className="text-caption text-text-tertiary mt-1 line-clamp-2">{p.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        {editing ? (
          <div className="bg-bg-primary border border-border-default rounded-lg p-5 sticky top-4">
            <h2 className="text-body font-semibold mb-4">{editing.id < 0 ? "새 프롬프트" : "편집"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-caption text-text-secondary">이름</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                       className="w-full px-3 py-2 border border-border-default rounded text-body" />
              </div>
              <div>
                <label className="text-caption text-text-secondary">대상</label>
                <select value={editing.audience} onChange={(e) => setEditing({ ...editing, audience: e.target.value as any })}
                        className="w-full px-3 py-2 border border-border-default rounded text-body">
                  <option value="teacher">교사</option>
                  <option value="student">학생</option>
                  <option value="both">공통</option>
                </select>
              </div>
              <div>
                <label className="text-caption text-text-secondary">시스템 프롬프트 (LLM에 시스템 메시지로 전달)</label>
                <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                          rows={12}
                          className="w-full px-3 py-2 border border-border-default rounded text-body font-mono" />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-body">
                  <input type="checkbox" checked={editing.is_default}
                         onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
                  기본값 (새 세션 자동 적용)
                </label>
                <label className="flex items-center gap-2 text-body">
                  <input type="checkbox" checked={editing.is_active}
                         onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
                  활성화
                </label>
              </div>
              <div>
                <label className="text-caption text-text-secondary">정렬 순서</label>
                <input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) })}
                       className="w-32 px-3 py-2 border border-border-default rounded text-body" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={save} className="px-4 py-2 bg-accent text-white rounded text-body">저장</button>
                <button onClick={() => setEditing(null)} className="px-4 py-2 border border-border-default rounded text-body">취소</button>
                {editing.id > 0 && (
                  <button onClick={() => remove(editing.id)} className="ml-auto flex items-center gap-1 text-status-error text-body">
                    <Trash2 size={14} /> 삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-text-tertiary text-center py-12 border-2 border-dashed border-border-default rounded-lg">
            왼쪽에서 프롬프트를 선택하거나<br />새로 만드세요
          </div>
        )}
      </div>
    </div>
  );
}
