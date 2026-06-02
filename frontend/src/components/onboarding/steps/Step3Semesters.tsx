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
  subjects?: string[];
}

export function Step3Semesters({ gradeCount }: { gradeCount: number }) {
  const [items, setItems] = useState<Semester[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [semester, setSemester] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [subjectInput, setSubjectInput] = useState("");
  const [savingSubj, setSavingSubj] = useState(false);

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

  // 개설 과목 — 현재 학기(없으면 첫 학기) 기준. me/setup·템플릿 드롭다운의 표준 소스.
  const currentSem = items.find((s) => s.is_current) || items[0] || null;

  const saveSubjects = async (next: string[]) => {
    if (!currentSem) return;
    setSavingSubj(true);
    try {
      await api.put(`/api/timetable/semesters/${currentSem.id}/structure`, { subjects: next });
      await load();
    } catch (e: any) { alert(e?.detail || e?.message || "과목 저장 실패"); }
    finally { setSavingSubj(false); }
  };
  const addSubject = async () => {
    const v = subjectInput.trim();
    if (!v || !currentSem) return;
    const cur = currentSem.subjects || [];
    if (cur.includes(v)) { setSubjectInput(""); return; }
    await saveSubjects([...cur, v]);
    setSubjectInput("");
  };
  const removeSubject = (s: string) => {
    if (!currentSem) return;
    saveSubjects((currentSem.subjects || []).filter((x) => x !== s));
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

      {/* 개설 과목 — 교사 담당과목 선택의 표준 목록 (자유입력 X) */}
      {currentSem && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4 mt-4">
          <h3 className="text-body font-semibold text-text-primary mb-1">
            개설 과목 <span className="text-[11px] text-text-tertiary font-normal">— {currentSem.name} 기준</span>
          </h3>
          <p className="text-caption text-text-tertiary mb-3">
            여기서 한 번 등록하면, 교사 담당 과목·템플릿이 이 목록을 <strong>드롭다운으로 선택</strong>합니다(자유입력 방지).
            나중에 과목이 추가/변경되면 여기나 <code className="text-accent">시스템 → 학기 관리</code>에서 수정하세요.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text" value={subjectInput} onChange={(e) => setSubjectInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSubject()}
              placeholder="과목명 (예: 수학, 미적분, 물리학Ⅰ)"
              className="flex-1 px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
            />
            <button
              type="button" onClick={addSubject} disabled={savingSubj || !subjectInput.trim()}
              className="px-3 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
            >
              <Plus size={14} /> 추가
            </button>
          </div>
          {(currentSem.subjects || []).length === 0 ? (
            <div className="text-[12px] text-text-tertiary">아직 등록된 과목이 없습니다. 위에서 추가하세요.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(currentSem.subjects || []).map((s) => (
                <span key={s} className="inline-flex items-center gap-1 px-2 py-1 text-[12px] bg-bg-secondary border border-border-default rounded">
                  {s}
                  <button type="button" onClick={() => removeSubject(s)} disabled={savingSubj} className="text-text-tertiary hover:text-red-500">
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 마법사 후 <code className="text-accent">시스템 → 학기 관리</code>에서 추가/수정 가능합니다.
      </div>
    </div>
  );
}
