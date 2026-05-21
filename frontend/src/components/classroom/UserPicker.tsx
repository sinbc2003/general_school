"use client";

/**
 * 사용자 선택 picker — 공유 모달에서 사용.
 *
 * 기능:
 *  - 교사/학생 탭
 *  - 교사: 부서 드롭다운 + 이름 검색
 *  - 학생: 학년 + 반 드롭다운 + 이름 검색
 *  - 그룹 일괄 추가:
 *    · 학생: 현재 학년 전체 / 현재 반 전체
 *    · 교사: 현재 부서 전체 / 전체 교직원(교사+직원)
 *
 * onPick(user_ids: number[]) — 호출 시 부모가 일괄 add member 처리.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, GraduationCap, Briefcase, Search, UserPlus, Loader2, Plus,
} from "lucide-react";
import { api } from "@/lib/api/client";

type Tab = "teacher" | "student";

interface UserRow {
  id: number;
  name: string;
  email?: string | null;
  role: string;
  grade?: number | null;
  class_number?: number | null;
  student_number?: number | null;
  department_id?: number | null;
  department?: string | null;
}

interface Department {
  id: number;
  name: string;
}

interface Props {
  excludedUserIds?: number[];
  onPick: (userIds: number[]) => Promise<void>;
}

export function UserPicker({ excludedUserIds = [], onPick }: Props) {
  const [tab, setTab] = useState<Tab>("teacher");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [grade, setGrade] = useState<number | "">("");
  const [classNumber, setClassNumber] = useState<number | "">("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [results, setResults] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);

  // 부서 list 로드 (교사 탭용)
  useEffect(() => {
    api.get<{ items: Department[] }>("/api/departments")
      .then((d) => setDepartments(d.items || []))
      .catch(() => setDepartments([]));
  }, []);

  // 검색 — 탭/필터 변경 시 자동 호출
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ per_page: "30" });
      if (tab === "teacher") {
        params.set("role", "teacher");
        if (departmentId !== "") params.set("department_id", String(departmentId));
      } else {
        params.set("role", "student");
        if (grade !== "") params.set("grade", String(grade));
        if (classNumber !== "") params.set("class_number", String(classNumber));
      }
      if (search.trim()) params.set("search", search.trim());
      const r = await api.get<{ items: UserRow[] }>(`/api/users?${params}`);
      setResults(r.items || []);
    } catch (e: any) {
      setResults([]);
    } finally { setLoading(false); }
  }, [tab, departmentId, grade, classNumber, search]);

  // 탭/필터 변경 시 즉시, 검색어는 300ms 디바운스
  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  const filteredResults = useMemo(
    () => results.filter((u) => !excludedUserIds.includes(u.id)),
    [results, excludedUserIds],
  );

  // 그룹 추가 — 전체 id 한 번에 fetch 후 onPick
  const addGroup = async (params: Record<string, string>) => {
    setPicking(true);
    try {
      const qs = new URLSearchParams({ per_page: "500", ...params });
      const r = await api.get<{ items: UserRow[] }>(`/api/users?${qs}`);
      const ids = (r.items || [])
        .map((u) => u.id)
        .filter((id) => !excludedUserIds.includes(id));
      if (ids.length === 0) {
        alert("추가할 사용자가 없습니다.");
        return;
      }
      if (!confirm(`${ids.length}명을 한 번에 추가합니다. 진행할까요?`)) return;
      await onPick(ids);
    } catch (e: any) {
      alert(e?.detail || "그룹 추가 실패");
    } finally {
      setPicking(false);
    }
  };

  const addOne = async (uid: number) => {
    setPicking(true);
    try {
      await onPick([uid]);
    } finally { setPicking(false); }
  };

  return (
    <div className="text-body">
      {/* 탭 */}
      <div className="flex border-b border-border-default mb-3">
        <button
          type="button"
          onClick={() => setTab("teacher")}
          className={`flex-1 py-2 text-caption inline-flex items-center justify-center gap-1.5 border-b-2 ${
            tab === "teacher" ? "border-accent text-accent font-medium" : "border-transparent text-text-secondary"
          }`}
        >
          <Briefcase size={13} /> 교사 / 직원
        </button>
        <button
          type="button"
          onClick={() => setTab("student")}
          className={`flex-1 py-2 text-caption inline-flex items-center justify-center gap-1.5 border-b-2 ${
            tab === "student" ? "border-accent text-accent font-medium" : "border-transparent text-text-secondary"
          }`}
        >
          <GraduationCap size={13} /> 학생
        </button>
      </div>

      {/* 필터 row */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {tab === "teacher" ? (
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : "")}
            className="px-2 py-1.5 text-caption border border-border-default rounded bg-bg-primary"
          >
            <option value="">전체 부서</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        ) : (
          <>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value ? Number(e.target.value) : "")}
              className="px-2 py-1.5 text-caption border border-border-default rounded bg-bg-primary"
            >
              <option value="">전체 학년</option>
              {[1, 2, 3].map((g) => <option key={g} value={g}>{g}학년</option>)}
            </select>
            <select
              value={classNumber}
              onChange={(e) => setClassNumber(e.target.value ? Number(e.target.value) : "")}
              className="px-2 py-1.5 text-caption border border-border-default rounded bg-bg-primary"
            >
              <option value="">전체 반</option>
              {Array.from({ length: 15 }, (_, i) => i + 1).map((c) => (
                <option key={c} value={c}>{c}반</option>
              ))}
            </select>
          </>
        )}
        <div className="relative flex-1 min-w-[140px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·이메일 검색"
            className="w-full pl-7 pr-2 py-1.5 text-caption border border-border-default rounded bg-bg-primary outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 그룹 일괄 추가 */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tab === "teacher" ? (
          <>
            {departmentId !== "" && (
              <GroupButton
                label={`이 부서 전체 추가`}
                onClick={() => addGroup({ role: "teacher", department_id: String(departmentId) })}
                disabled={picking}
              />
            )}
            <GroupButton
              label="전체 교사 추가"
              onClick={() => addGroup({ role: "teacher" })}
              disabled={picking}
            />
            <GroupButton
              label="전체 직원 추가"
              onClick={() => addGroup({ role: "staff" })}
              disabled={picking}
            />
          </>
        ) : (
          <>
            {grade !== "" && classNumber !== "" && (
              <GroupButton
                label={`${grade}학년 ${classNumber}반 전체`}
                onClick={() => addGroup({
                  role: "student", grade: String(grade), class_number: String(classNumber),
                })}
                disabled={picking}
              />
            )}
            {grade !== "" && (
              <GroupButton
                label={`${grade}학년 전체`}
                onClick={() => addGroup({ role: "student", grade: String(grade) })}
                disabled={picking}
              />
            )}
            <GroupButton
              label="전체 학생 추가"
              onClick={() => addGroup({ role: "student" })}
              disabled={picking}
            />
          </>
        )}
      </div>

      {/* 검색 결과 list */}
      <div className="border border-border-default rounded bg-bg-primary max-h-[280px] overflow-y-auto">
        {loading ? (
          <div className="px-3 py-6 text-caption text-text-tertiary inline-flex items-center gap-2">
            <Loader2 size={11} className="animate-spin" /> 검색 중...
          </div>
        ) : filteredResults.length === 0 ? (
          <div className="px-3 py-6 text-caption text-text-tertiary text-center">
            결과 없음
          </div>
        ) : (
          filteredResults.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => addOne(u.id)}
              disabled={picking}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary text-left disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <div className="text-body text-text-primary truncate">
                  {u.name}
                  {u.role === "student" && u.grade && u.class_number && u.student_number && (
                    <span className="text-[11px] text-text-tertiary ml-2">
                      {u.grade}{String(u.class_number).padStart(2, "0")}{String(u.student_number).padStart(2, "0")}
                    </span>
                  )}
                  {(u.role === "teacher" || u.role === "staff") && u.department && (
                    <span className="text-[11px] text-text-tertiary ml-2">{u.department}</span>
                  )}
                </div>
                <div className="text-[11px] text-text-tertiary truncate">{u.email || u.role}</div>
              </div>
              <Plus size={14} className="text-accent flex-shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}


function GroupButton({
  label, onClick, disabled,
}: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-accent/10 text-accent border border-accent/30 rounded hover:bg-accent/20 disabled:opacity-50"
    >
      <UserPlus size={11} /> {label}
    </button>
  );
}
