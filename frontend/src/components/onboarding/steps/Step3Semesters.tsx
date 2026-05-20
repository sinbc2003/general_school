"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface Semester {
  id: number;
  name: string;
  year: number;
  semester: number;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  is_archived: boolean;
}

export function Step3Semesters({ gradeCount }: { gradeCount: number }) {
  const [items, setItems] = useState<Semester[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [semester, setSemester] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Semester[] | { items: Semester[] }>("/api/timetable/semesters");
      const list = Array.isArray(r) ? r : (r as any).items || [];
      setItems(list);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const y = new Date().getFullYear();
    setYear(y);
    setName(`${y}학년도 1학기`);
  }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.post("/api/timetable/semesters", {
        name: name.trim(),
        year,
        semester,
        start_date: startDate || null,
        end_date: endDate || null,
        is_current: items.length === 0,  // 첫 학기는 자동 current
      });
      setName(""); setStartDate(""); setEndDate("");
      await load();
    } catch (e: any) { alert(e?.message); }
  };

  const remove = async (s: Semester) => {
    if (!confirm(`"${s.name}" 학기를 삭제하시겠습니까?\n관련 명단·강좌가 모두 삭제됩니다.`)) return;
    try { await api.delete(`/api/timetable/semesters/${s.id}`); await load(); } catch (e: any) { alert(e?.message); }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-body font-semibold text-text-primary">학기 등록</h2>
        <p className="text-caption text-text-tertiary mt-1">
          현재 학기 1개만 등록해도 충분합니다. 학기마다 명단·강좌가 격리되어 보존됩니다.
        </p>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">학기명</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[11px] text-text-secondary mb-1">학년도</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div className="w-20">
              <label className="block text-[11px] text-text-secondary mb-1">학기</label>
              <select
                value={semester}
                onChange={(e) => setSemester(Number(e.target.value))}
                className="w-full px-2 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">시작일</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-[11px] text-text-secondary mb-1">종료일</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!name.trim()}
          className="px-4 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
        >
          <Plus size={14} /> 학기 추가
        </button>
      </div>

      {loading ? (
        <div className="text-text-tertiary">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary border-2 border-dashed border-border-default rounded-lg">
          학기를 1개 이상 등록하세요.
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg divide-y divide-border-default">
          {items.map((s) => (
            <div key={s.id} className="px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-body text-text-primary">{s.name}</span>
                {s.is_current && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">현재</span>
                )}
                {s.is_archived && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">보관</span>
                )}
                <span className="text-[11px] text-text-tertiary">
                  {s.start_date || "?"} ~ {s.end_date || "?"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(s)}
                className="p-1 rounded hover:bg-red-50 text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 마법사 후 <code className="text-accent">시스템 → 학기 관리</code>에서 추가/수정 가능합니다.
      </div>
    </div>
  );
}
