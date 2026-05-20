"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { api } from "@/lib/api/client";

interface Department {
  id: number;
  name: string;
  description: string | null;
  lead_user_id: number | null;
  lead_name: string | null;
  sort_order: number;
}

const DEFAULT_DEPARTMENTS = [
  "교무부", "학생부", "연구부", "진로상담부", "교육과정부", "정보부", "방과후부",
];

export function Step2Departments() {
  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: Department[] }>("/api/departments");
      setItems(r.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post("/api/departments", { name, sort_order: items.length });
      setNewName("");
      await load();
    } catch (e: any) { alert(e?.message); }
  };

  const seed = async () => {
    try {
      const r = await api.post<{ created: number; skipped: number }>(
        "/api/departments/_bulk",
        { departments: DEFAULT_DEPARTMENTS.map((name, i) => ({ name, sort_order: items.length + i })) }
      );
      if (r.created > 0) alert(`${r.created}개 신규 등록${r.skipped > 0 ? `, ${r.skipped}개 skip` : ""}`);
      await load();
    } catch (e: any) { alert(e?.message); }
  };

  const remove = async (d: Department) => {
    if (!confirm(`"${d.name}" 삭제하시겠습니까?`)) return;
    try { await api.delete(`/api/departments/${d.id}`); await load(); } catch (e: any) { alert(e?.message); }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-body font-semibold text-text-primary">부서 등록</h2>
        <p className="text-caption text-text-tertiary mt-1">
          학교 조직 단위. 부장교사는 다음 단계(교사 등록) 후에 지정합니다.
        </p>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 부서명 (예: 교무부)"
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="flex-1 px-3 py-2 text-body border border-border-default rounded-md bg-bg-primary"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newName.trim()}
            className="px-3 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
          >
            <Plus size={14} /> 추가
          </button>
          <button
            type="button"
            onClick={seed}
            className="px-3 py-2 text-[12px] text-accent border border-accent/30 rounded-md hover:bg-accent/5 flex items-center gap-1"
          >
            <Sparkles size={12} /> 표준 부서
          </button>
        </div>
        <div className="text-[11px] text-text-tertiary mt-2">
          표준 부서: {DEFAULT_DEPARTMENTS.join(" · ")}
        </div>
      </div>

      {loading ? (
        <div className="text-text-tertiary">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-text-tertiary border-2 border-dashed border-border-default rounded-lg">
          아직 등록된 부서가 없습니다. 위에서 추가하거나 [표준 부서]를 클릭하세요.
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg divide-y divide-border-default">
          {items.map((d, i) => (
            <div key={d.id} className="px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-text-tertiary text-[12px] w-6">{i + 1}</span>
                <span className="text-body text-text-primary">{d.name}</span>
                {d.lead_name && (
                  <span className="text-[11px] text-text-tertiary">· 부장: {d.lead_name}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(d)}
                className="p-1 rounded hover:bg-red-50 text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 마법사 종료 후 <code className="text-accent">시스템 → 부서 관리</code>에서 언제든 수정 가능합니다.
      </div>
    </div>
  );
}
