"use client";

/**
 * 부서 관리 — super_admin / designated_admin 전용.
 * - 줄별 입력 (부서명 + 부장 드롭다운 + sort_order)
 * - 신규 추가 / 수정 / 삭제 / 일괄 등록
 * - 부서 삭제 시 소속 사용자의 department_id는 자동 NULL (FK SET NULL)
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import Link from "next/link";
import { Building2, Plus, Trash2, Save, ChevronUp, ChevronDown, X, Shield } from "lucide-react";

interface Department {
  id: number;
  name: string;
  description: string | null;
  lead_user_id: number | null;
  lead_name: string | null;
  lead_email: string | null;
  sort_order: number;
}

interface TeacherOption {
  id: number;
  name: string;
  email: string;
}

// 한국 학교 표준 부서 예시 (prefilled 추천)
const DEFAULT_DEPARTMENTS = [
  "교무부", "학생부", "연구부", "진로상담부", "교육과정부", "정보부", "방과후부",
];

export default function DepartmentsPage() {
  const [items, setItems] = useState<Department[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, u] = await Promise.all([
        api.get<{ items: Department[] }>("/api/departments"),
        api.get<{ items: TeacherOption[] } | TeacherOption[]>(
          "/api/users?role=teacher,staff,designated_admin,super_admin&limit=500"
        ),
      ]);
      setItems(d.items);
      // /api/users 응답이 array | { items: [] } 둘 다 호환
      const list = Array.isArray(u) ? u : (u as any).items || (u as any).users || [];
      setTeachers(list.map((t: any) => ({ id: t.id, name: t.name, email: t.email })));
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post("/api/departments", { name, sort_order: items.length });
      setNewName("");
      await load();
    } catch (e: any) {
      alert(e?.message || "추가 실패");
    }
  };

  const seedDefaults = async () => {
    if (!confirm(`표준 부서 ${DEFAULT_DEPARTMENTS.length}개를 일괄 등록합니다.\n이미 있는 부서는 건너뜁니다.`)) return;
    try {
      const departments = DEFAULT_DEPARTMENTS.map((name, i) => ({ name, sort_order: items.length + i }));
      const r = await api.post<{ created: number; skipped: number }>("/api/departments/_bulk", { departments });
      alert(`${r.created}개 신규 등록, ${r.skipped}개 중복 skip`);
      await load();
    } catch (e: any) {
      alert(e?.message || "일괄 등록 실패");
    }
  };

  const update = async (d: Department, patch: Partial<Department>) => {
    try {
      await api.put(`/api/departments/${d.id}`, patch);
      await load();
    } catch (e: any) {
      alert(e?.message || "수정 실패");
    }
  };

  const remove = async (d: Department) => {
    if (!confirm(`"${d.name}" 부서를 삭제하시겠습니까?\n소속 교사의 부서 정보는 비워집니다.`)) return;
    try {
      await api.delete(`/api/departments/${d.id}`);
      await load();
    } catch (e: any) {
      alert(e?.message || "삭제 실패");
    }
  };

  const move = async (d: Department, dir: -1 | 1) => {
    const idx = items.findIndex((x) => x.id === d.id);
    const tgt = items[idx + dir];
    if (!tgt) return;
    await Promise.all([
      api.put(`/api/departments/${d.id}`, { sort_order: tgt.sort_order }),
      api.put(`/api/departments/${tgt.id}`, { sort_order: d.sort_order }),
    ]);
    await load();
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Building2 size={20} className="text-text-primary" />
          <h1 className="text-title text-text-primary">부서 관리</h1>
        </div>
        <p className="text-caption text-text-tertiary">
          학교 조직 단위. 부서별로 부장교사 1명 지정 가능. 추후 부서장이 계원에게 업무 권한을 위임할 수 있습니다.
        </p>
      </div>

      {/* 새 부서 추가 */}
      <div className="mb-4 bg-bg-primary border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 부서명 (예: 교무부)"
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="flex-1 px-3 py-2 text-body border border-border-default rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newName.trim()}
            className="px-4 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Plus size={14} /> 추가
          </button>
          {items.length === 0 && (
            <button
              type="button"
              onClick={seedDefaults}
              className="px-3 py-2 text-[12px] text-accent border border-accent/30 rounded-md hover:bg-accent/5"
            >
              표준 부서 일괄 등록
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      {error ? (
        <div className="text-red-600">{error}</div>
      ) : loading ? (
        <div className="text-text-tertiary">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-16 text-center">
          <Building2 size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">등록된 부서가 없습니다</div>
          <div className="text-caption text-text-tertiary mt-1">
            위 입력에서 부서명을 추가하거나 "표준 부서 일괄 등록"을 클릭하세요
          </div>
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-bg-secondary border-b border-border-default">
              <tr className="text-left text-text-tertiary">
                <th className="px-3 py-2 w-10">#</th>
                <th className="px-3 py-2">부서명</th>
                <th className="px-3 py-2">부장교사</th>
                <th className="px-3 py-2 w-32 text-right">정렬</th>
                <th className="px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d, i) => (
                <tr key={d.id} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                  <td className="px-3 py-2 text-text-tertiary">{i + 1}</td>
                  <td className="px-3 py-2">
                    <InlineText
                      value={d.name}
                      onSave={(v) => update(d, { name: v })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={d.lead_user_id || 0}
                      onChange={(e) => update(d, { lead_user_id: Number(e.target.value) })}
                      className="px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                    >
                      <option value={0}>— 미지정 —</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} ({t.email})</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => move(d, -1)}
                        disabled={i === 0}
                        className="p-1 rounded hover:bg-bg-secondary text-text-tertiary disabled:opacity-30"
                        title="위로"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(d, 1)}
                        disabled={i === items.length - 1}
                        className="p-1 rounded hover:bg-bg-secondary text-text-tertiary disabled:opacity-30"
                        title="아래로"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/system/departments/${d.id}/delegations`}
                        className="p-1 rounded hover:bg-accent/10 text-accent"
                        title="권한 위임"
                      >
                        <Shield size={14} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => remove(d)}
                        className="p-1 rounded hover:bg-red-50 text-red-500"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InlineText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-text-primary text-left hover:text-accent"
      >
        {value}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        autoFocus
        onBlur={() => { if (v !== value && v.trim()) onSave(v.trim()); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { if (v !== value && v.trim()) onSave(v.trim()); setEditing(false); }
          if (e.key === "Escape") { setV(value); setEditing(false); }
        }}
        className="px-2 py-1 text-[13px] border border-border-default rounded bg-bg-primary w-full"
      />
    </div>
  );
}
