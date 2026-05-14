"use client";

/**
 * 시간표 페이지.
 *
 * TODO(시간표 CSV 일괄 업로드):
 *   컴시/알리미 등 시간표 업체의 표준 export 포맷이 확보되면
 *   /api/timetable/entries/bulk + CSV 파서 추가 예정.
 *   교사별 시간표를 한 번에 import 가능하게.
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Plus, Save, Calendar, CalendarClock } from "lucide-react";
import { MyEventsModal } from "@/components/timetable/MyEventsModal";
import { useAuth } from "@/lib/auth-context";

const ENTRY_TYPE_BG: Record<string, string> = {
  class: "",
  meeting: "bg-purple-50",
  consultation: "bg-orange-50",
  event: "bg-pink-50",
  other: "bg-gray-50",
};

interface Semester {
  id: number;
  year: number;
  semester: number;
  is_current: boolean;
}

interface TimetableEntry {
  id?: number;
  semester_id: number;
  day_of_week: number;
  period: number;
  subject: string;
  class_name: string;
  teacher_id: number | null;
  entry_type?: "class" | "meeting" | "consultation" | "event" | "other";
  note?: string | null;
  _dirty?: boolean;  // 클라이언트에서만 사용: 변경 표시
}

const DAYS = ["월", "화", "수", "목", "금"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

export default function TimetablePage() {
  const { user, isSuperAdmin } = useAuth();
  const isAdmin = isSuperAdmin || user?.role === "designated_admin";

  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [showNewSemester, setShowNewSemester] = useState(false);
  const [newYear, setNewYear] = useState(new Date().getFullYear());
  const [newSemester, setNewSemester] = useState(1);
  const [showMyEvents, setShowMyEvents] = useState(false);

  const fetchSemesters = useCallback(async () => {
    try {
      const data = await api.get("/api/timetable/semesters");
      setSemesters(data);
      const current = data.find((s: Semester) => s.is_current);
      if (current) {
        setSelectedSemester(current.id);
      } else if (data.length > 0) {
        setSelectedSemester(data[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchEntries = useCallback(async () => {
    if (!selectedSemester) return;
    setLoading(true);
    try {
      // 교사는 본인 시간표만, 관리자는 전체
      const teacherQ = !isAdmin && user ? `&teacher_id=${user.id}` : "";
      const data = await api.get(
        `/api/timetable/entries?semester_id=${selectedSemester}${teacherQ}`
      );
      setEntries(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedSemester, isAdmin, user]);

  useEffect(() => {
    fetchSemesters();
  }, [fetchSemesters]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const getEntry = (day: number, period: number): TimetableEntry | undefined =>
    entries.find((e) => e.day_of_week === day && e.period === period);

  const cellKey = (day: number, period: number) => `${day}-${period}`;

  // 본인 entry 또는 admin만 편집 가능
  const canEditEntry = (e: TimetableEntry | undefined): boolean => {
    if (isAdmin) return true;
    if (!e || !user) return false;
    return e.teacher_id === user.id;
  };

  const handleCellChange = (
    day: number,
    period: number,
    field: "subject" | "class_name",
    value: string
  ) => {
    setEntries((prev) => {
      const existing = prev.find(
        (e) => e.day_of_week === day && e.period === period
      );
      if (existing) {
        // 본인 entry 또는 admin만 변경 허용
        if (!canEditEntry(existing)) return prev;
        return prev.map((e) =>
          e.day_of_week === day && e.period === period
            ? { ...e, [field]: value, _dirty: true }
            : e
        );
      }
      // 빈 셀에 새로 입력 — admin만 가능 (교사는 본인 entry 수정만)
      if (!isAdmin) return prev;
      return [
        ...prev,
        {
          semester_id: selectedSemester!,
          day_of_week: day,
          period,
          subject: field === "subject" ? value : "",
          class_name: field === "class_name" ? value : "",
          teacher_id: null,
          entry_type: "class",
          _dirty: true,
        },
      ];
    });
  };

  const handleSave = async () => {
    if (!selectedSemester) return;
    setSaving(true);
    try {
      if (isAdmin) {
        // 관리자: bulk 일괄 저장 (기존 흐름)
        const validEntries = entries
          .filter((e) => e.subject.trim())
          .map(({ id, _dirty, entry_type, note, ...rest }) => ({
            day_of_week: rest.day_of_week,
            period: rest.period,
            subject: rest.subject,
            class_name: rest.class_name,
            teacher_id: rest.teacher_id,
          }));
        await api.post("/api/timetable/entries/bulk", {
          semester_id: selectedSemester,
          entries: validEntries,
        });
      } else {
        // 교사: 변경된 본인 entries만 단일 PUT (id 있는 것만)
        const dirty = entries.filter((e) => e._dirty && e.id);
        if (dirty.length === 0) {
          alert("변경된 항목이 없습니다.");
          setSaving(false);
          return;
        }
        for (const e of dirty) {
          await api.put(`/api/timetable/entries/${e.id}`, {
            subject: e.subject,
            class_name: e.class_name,
            room: (e as any).room,
            note: e.note,
          });
        }
      }
      alert("시간표가 저장되었습니다.");
      fetchEntries();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSemester = async () => {
    try {
      await api.post("/api/timetable/semesters", {
        year: newYear,
        semester: newSemester,
      });
      setShowNewSemester(false);
      fetchSemesters();
    } catch (err: any) {
      alert(err?.detail || "학기 생성 실패");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">시간표 관리</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMyEvents(true)}
            disabled={!selectedSemester}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default text-text-primary rounded hover:bg-bg-secondary disabled:opacity-40"
            title="회의·면담·행사 등 개인 일정 추가/수정"
          >
            <CalendarClock size={14} /> 내 개인 일정
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedSemester}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
          >
            <Save size={14} />
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <MyEventsModal
        show={showMyEvents}
        onClose={() => { setShowMyEvents(false); fetchEntries(); }}
        semesterId={selectedSemester}
      />

      {/* 학기 선택 */}
      <div className="flex items-center gap-3 mb-6">
        <Calendar size={16} className="text-text-tertiary" />
        <select
          value={selectedSemester ?? ""}
          onChange={(e) => setSelectedSemester(Number(e.target.value))}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="" disabled>
            학기 선택
          </option>
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.year}년 {s.semester}학기 {s.is_current ? "(현재)" : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowNewSemester(!showNewSemester)}
          className="flex items-center gap-1 px-2 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          <Plus size={14} />
          새 학기
        </button>
      </div>

      {/* 새 학기 생성 폼 */}
      {showNewSemester && (
        <div className="mb-6 p-4 bg-bg-primary rounded-lg border border-border-default">
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-caption text-text-tertiary mb-1">
                연도
              </label>
              <input
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(Number(e.target.value))}
                className="w-24 px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-caption text-text-tertiary mb-1">
                학기
              </label>
              <select
                value={newSemester}
                onChange={(e) => setNewSemester(Number(e.target.value))}
                className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              >
                <option value={1}>1학기</option>
                <option value={2}>2학기</option>
              </select>
            </div>
            <button
              onClick={handleCreateSemester}
              className="px-4 py-1.5 text-body bg-accent text-white rounded hover:opacity-90"
            >
              생성
            </button>
            <button
              onClick={() => setShowNewSemester(false)}
              className="px-3 py-1.5 text-body border border-border-default rounded hover:bg-bg-secondary"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 시간표 그리드 */}
      {selectedSemester ? (
        loading ? (
          <div className="text-center py-8 text-body text-text-tertiary">
            로딩 중...
          </div>
        ) : (
          <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-bg-secondary">
                  <th className="px-3 py-2 text-center text-caption text-text-tertiary font-medium w-16">
                    교시
                  </th>
                  {DAYS.map((day, i) => (
                    <th
                      key={i}
                      className="px-3 py-2 text-center text-caption text-text-tertiary font-medium"
                    >
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERIODS.map((period) => (
                  <tr key={period} className="border-t border-border-default">
                    <td className="px-3 py-2 text-center text-caption text-text-tertiary font-medium bg-bg-secondary">
                      {period}
                    </td>
                    {DAYS.map((_, dayIdx) => {
                      const entry = getEntry(dayIdx, period);
                      const key = cellKey(dayIdx, period);
                      const isEditing = editingCell === key;
                      const editable = entry ? canEditEntry(entry) : isAdmin;
                      const typeBg = entry?.entry_type ? ENTRY_TYPE_BG[entry.entry_type] || "" : "";
                      return (
                        <td
                          key={dayIdx}
                          className={`px-1 py-1 text-center border-l border-border-default ${typeBg}`}
                          onClick={() => { if (editable) setEditingCell(key); }}
                          title={!editable && entry ? "다른 교사의 시간표는 수정할 수 없습니다" : undefined}
                        >
                          {isEditing ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={entry?.subject || ""}
                                onChange={(e) =>
                                  handleCellChange(
                                    dayIdx,
                                    period,
                                    "subject",
                                    e.target.value
                                  )
                                }
                                onBlur={() => setEditingCell(null)}
                                placeholder="과목"
                                className="w-full px-1 py-0.5 text-caption border border-accent rounded bg-bg-primary focus:outline-none text-center"
                                autoFocus
                              />
                              <input
                                type="text"
                                value={entry?.class_name || ""}
                                onChange={(e) =>
                                  handleCellChange(
                                    dayIdx,
                                    period,
                                    "class_name",
                                    e.target.value
                                  )
                                }
                                onBlur={() => setEditingCell(null)}
                                placeholder="반"
                                className="w-full px-1 py-0.5 text-[10px] border border-border-default rounded bg-bg-primary focus:outline-none text-center"
                              />
                            </div>
                          ) : (
                            <div className="min-h-[40px] flex flex-col items-center justify-center cursor-pointer hover:bg-bg-secondary rounded p-1">
                              {entry?.subject ? (
                                <>
                                  <div className="text-caption text-text-primary font-medium">
                                    {entry.subject}
                                  </div>
                                  {entry.class_name && (
                                    <div className="text-[10px] text-text-tertiary">
                                      {entry.class_name}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="text-[10px] text-text-tertiary">
                                  -
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="text-center py-8 text-body text-text-tertiary">
          학기를 선택하세요
        </div>
      )}
    </div>
  );
}
