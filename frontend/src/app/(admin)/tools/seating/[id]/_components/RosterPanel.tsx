"use client";

/** 명단 패널 — 담임/강좌 가져오기 + 직접 입력 + 편집(번호·이름·제외). */

import { useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus, GraduationCap, BookOpen, EyeOff, Eye } from "lucide-react";
import { api } from "@/lib/api/client";
import { RosterEntry, genKey, studentsToRoster } from "../../_shared";

interface CourseItem { id: number; name: string }

interface Props {
  roster: RosterEntry[];
  excluded: string[];
  onChange: (roster: RosterEntry[]) => void;
  onToggleExcluded: (key: string) => void;
}

export default function RosterPanel({ roster, excluded, onChange, onToggleExcluded }: Props) {
  const [courses, setCourses] = useState<CourseItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const exSet = new Set(excluded);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ items?: CourseItem[] } | CourseItem[]>("/api/classroom/courses");
        setCourses(Array.isArray(res) ? res : res.items || []);
      } catch { setCourses([]); }
    })();
  }, []);

  const replaceIfConfirmed = (next: RosterEntry[]) => {
    if (roster.length > 0 && !confirm(`현재 명단 ${roster.length}명을 새 명단으로 교체할까요?`)) return;
    onChange(next);
  };

  const loadHomeroom = async () => {
    setBusy("homeroom");
    try {
      const res = await api.get<{ label: string | null; students: any[] }>("/api/tools/seating/_homeroom");
      if (!res.students?.length) {
        alert("담임 학급 명단을 찾을 수 없습니다. (현재 학기 담임이 아니거나 학생이 없습니다)\n강좌에서 불러오거나 직접 입력하세요.");
        return;
      }
      replaceIfConfirmed(studentsToRoster(res.students));
    } catch (e: any) {
      alert(e?.detail || "불러오기 실패");
    } finally { setBusy(null); }
  };

  const loadCourse = async (cid: string) => {
    if (!cid) return;
    setBusy("course");
    try {
      const res = await api.get<{ students: any[] }>(`/api/classroom/courses/${cid}`);
      if (!res.students?.length) { alert("이 강좌에 학생이 없습니다."); return; }
      replaceIfConfirmed(studentsToRoster(res.students));
    } catch (e: any) {
      alert(e?.detail || "불러오기 실패");
    } finally { setBusy(null); }
  };

  const addManual = () => {
    const names = manualText.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!names.length) return;
    const existing = new Set(roster.map((r) => r.name));
    const startNo = roster.length;
    const adds: RosterEntry[] = [];
    names.forEach((name, i) => {
      if (existing.has(name)) return;
      adds.push({ key: genKey(), name, number: startNo + i + 1, student_number: null, user_id: null });
    });
    onChange([...roster, ...adds]);
    setManualText("");
    setManualOpen(false);
  };

  const update = (key: string, patch: Partial<RosterEntry>) =>
    onChange(roster.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(roster.filter((r) => r.key !== key));

  const activeCount = roster.filter((r) => !exSet.has(r.key)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={loadHomeroom}
          disabled={busy === "homeroom"}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-default text-body hover:bg-bg-secondary disabled:opacity-50"
        >
          {busy === "homeroom" ? <Loader2 size={15} className="animate-spin" /> : <GraduationCap size={15} />}
          담임 학급 명단
        </button>
        <div className="inline-flex items-center gap-1.5">
          <BookOpen size={15} className="text-text-tertiary" />
          <select
            onChange={(e) => loadCourse(e.target.value)}
            value=""
            className="px-2 py-2 border border-border-default rounded-lg text-body bg-bg-primary max-w-[200px]"
          >
            <option value="">강좌에서 불러오기...</option>
            {(courses || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {busy === "course" && <Loader2 size={15} className="animate-spin text-text-tertiary" />}
        </div>
        <button
          onClick={() => setManualOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-default text-body hover:bg-bg-secondary"
        >
          <UserPlus size={15} /> 직접 추가
        </button>
        {roster.length > 0 && (
          <button
            onClick={() => { if (confirm("명단을 모두 비울까요?")) onChange([]); }}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-caption text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={14} /> 전체 비우기
          </button>
        )}
      </div>

      {manualOpen && (
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary/40">
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={5}
            placeholder={"한 줄에 1명\n김철수\n이영희\n박민수"}
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-emerald-500 resize-y"
          />
          <div className="flex justify-end mt-2">
            <button onClick={addManual} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-body">
              추가
            </button>
          </div>
        </div>
      )}

      <div className="text-caption text-text-tertiary">
        총 {roster.length}명 · 배치 대상 {activeCount}명{roster.length - activeCount > 0 ? ` · 제외 ${roster.length - activeCount}명` : ""}
      </div>

      {roster.length === 0 ? (
        <div className="text-center text-caption text-text-tertiary py-10 border border-dashed border-border-default rounded-lg">
          담임 학급·강좌에서 불러오거나 직접 입력하세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {roster.map((r) => {
            const ex = exSet.has(r.key);
            return (
              <div
                key={r.key}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${
                  ex ? "border-border-default bg-bg-secondary/60 opacity-60" : "border-border-default"
                }`}
              >
                <input
                  type="number"
                  value={r.number ?? ""}
                  onChange={(e) => update(r.key, { number: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                  className="w-11 px-1 py-1 text-center border border-border-default rounded text-caption"
                  title="번호"
                />
                <input
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1 border border-border-default rounded text-body"
                />
                <button
                  onClick={() => onToggleExcluded(r.key)}
                  className={`p-1 rounded ${ex ? "text-amber-600" : "text-text-tertiary hover:text-amber-600"}`}
                  title={ex ? "배치 포함" : "배치 제외"}
                >
                  {ex ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={() => remove(r.key)} className="p-1 rounded text-text-tertiary hover:text-rose-600" title="삭제">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
