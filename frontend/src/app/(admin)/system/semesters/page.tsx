"use client";

/**
 * 학기 관리 페이지 (최고관리자 전용)
 * - 학기 CRUD
 * - 현재 학기 설정 (is_current=True 단 1개 보장)
 * - 이전 학기 → 다음 학기로 명단 일괄 진급/복제 (dry-run 지원)
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  Trash2,
  Edit3,
  X,
  CalendarRange,
  CheckCircle2,
  Circle,
  ArrowRight,
  AlertCircle,
  Download,
  Upload,
  School,
} from "lucide-react";
import { ChipInput } from "@/components/ui/ChipInput";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

interface Semester {
  id: number;
  year: number;
  semester: number;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  classes_per_grade?: Record<string, number>;
  subjects?: string[];
  departments?: string[];
}

interface FormData {
  year: number;
  semester: number;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

const EMPTY_FORM: FormData = {
  year: new Date().getFullYear(),
  semester: 1,
  name: "",
  start_date: "",
  end_date: "",
  is_current: false,
};

export default function SemestersPage() {
  const [items, setItems] = useState<Semester[]>([]);
  const [loading, setLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // 학기 생성 시 함께 받는 명단 CSV (선택 항목)
  const [teacherFile, setTeacherFile] = useState<File | null>(null);
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [createResult, setCreateResult] = useState<{
    semester?: Semester;
    teacher?: any;
    student?: any;
    error?: string;
  } | null>(null);

  // 학교 구조 모달 상태
  const [structureSid, setStructureSid] = useState<number | null>(null);
  const [structureForm, setStructureForm] = useState<{
    classes_per_grade: Record<string, number>;
    subjects: string[];
    departments: string[];
  }>({ classes_per_grade: { "1": 0, "2": 0, "3": 0 }, subjects: [], departments: [] });
  const [structureSaving, setStructureSaving] = useState(false);

  const openStructure = (s: Semester) => {
    setStructureSid(s.id);
    setStructureForm({
      classes_per_grade: { "1": 0, "2": 0, "3": 0, ...(s.classes_per_grade || {}) },
      subjects: s.subjects || [],
      departments: s.departments || [],
    });
  };

  const saveStructure = async () => {
    if (!structureSid) return;
    setStructureSaving(true);
    try {
      await api.put(`/api/timetable/semesters/${structureSid}/structure`, {
        classes_per_grade: structureForm.classes_per_grade,
        subjects: structureForm.subjects,
        departments: structureForm.departments,
      });
      await fetchSemesters();
      setStructureSid(null);
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setStructureSaving(false);
    }
  };

  // 진급 마법사 상태
  const [showPromote, setShowPromote] = useState(false);
  const [fromSid, setFromSid] = useState<number | null>(null);
  const [toSid, setToSid] = useState<number | null>(null);
  const [graduateGrade, setGraduateGrade] = useState<number | "">(3);
  const [copyTeachers, setCopyTeachers] = useState(true);
  const [promoteStudents, setPromoteStudents] = useState(true);
  const [promotePreview, setPromotePreview] = useState<any>(null);
  const [promoting, setPromoting] = useState(false);

  const fetchSemesters = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Semester[]>("/api/timetable/semesters");
      setItems(data);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "학기 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSemesters();
  }, [fetchSemesters]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTeacherFile(null);
    setStudentFile(null);
    setCreateResult(null);
    setShowForm(true);
  };

  const openEdit = (s: Semester) => {
    setEditingId(s.id);
    setForm({
      year: s.year,
      semester: s.semester,
      name: s.name,
      start_date: s.start_date.slice(0, 10),
      end_date: s.end_date.slice(0, 10),
      is_current: s.is_current,
    });
    setTeacherFile(null);
    setStudentFile(null);
    setCreateResult(null);
    setShowForm(true);
  };

  const downloadTemplate = async (role: "teacher" | "student", full = false) => {
    try {
      const token = localStorage.getItem("access_token");
      const url = `${API_URL}/api/timetable/enrollments/csv-template/${role}${full ? "?full=true" : ""}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("template download failed");
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `${role}${full ? "_full" : ""}_template.csv`;
      a.click();
      URL.revokeObjectURL(obj);
    } catch (err: any) {
      alert("템플릿 다운로드 실패: " + (err?.message || ""));
    }
  };

  // 학기 생성 시 명단 CSV import (학기 ID 확보 후 호출)
  const importCsv = async (sid: number, role: "teacher" | "student", file: File) => {
    const token = localStorage.getItem("access_token");
    const fd = new FormData();
    fd.append("file", file);
    const url = `${API_URL}/api/timetable/semesters/${sid}/import-enrollments?role=${role}&dry_run=false`;
    const res = await fetch(url, {
      method: "POST",
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || `${role} CSV 업로드 실패`);
    return data;
  };

  const submit = async () => {
    if (!form.year || !form.semester || !form.start_date || !form.end_date) {
      alert("학년도, 학기, 시작일, 종료일을 모두 입력하세요");
      return;
    }
    setSubmitting(true);
    setCreateResult(null);
    try {
      const body: any = {
        year: form.year,
        semester: form.semester,
        name: form.name || `${form.year}학년도 ${form.semester}학기`,
        start_date: form.start_date,
        end_date: form.end_date,
        is_current: form.is_current,
      };
      // 1. 학기 생성/수정
      let sid: number;
      let semObj: Semester | undefined;
      if (editingId) {
        await api.put(`/api/timetable/semesters/${editingId}`, body);
        sid = editingId;
      } else {
        semObj = await api.post<Semester>("/api/timetable/semesters", body);
        sid = semObj.id;
      }

      // 2. 명단 CSV (선택) — 생성/수정 모드 무관, 파일이 있으면 업로드
      const result: { semester?: Semester; teacher?: any; student?: any } = { semester: semObj };
      if (teacherFile) {
        try {
          result.teacher = await importCsv(sid, "teacher", teacherFile);
        } catch (err: any) {
          result.teacher = { error: err?.message || "교직원 CSV 실패" };
        }
      }
      if (studentFile) {
        try {
          result.student = await importCsv(sid, "student", studentFile);
        } catch (err: any) {
          result.student = { error: err?.message || "학생 CSV 실패" };
        }
      }

      setCreateResult(result);

      // 명단 업로드가 없으면 즉시 모달 닫고 갱신. 있으면 결과 확인 후 닫기.
      const hadCsv = !!teacherFile || !!studentFile;
      if (!hadCsv) {
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      fetchSemesters();
    } catch (err: any) {
      setCreateResult({ error: err?.detail || err?.message || "저장 실패" });
    } finally {
      setSubmitting(false);
    }
  };

  const setCurrent = async (sid: number) => {
    if (!confirm("이 학기를 현재 학기로 지정합니다. 기존 현재 학기는 해제됩니다. 진행하시겠습니까?"))
      return;
    try {
      await api.post(`/api/timetable/semesters/${sid}/set-current`);
      fetchSemesters();
    } catch (err: any) {
      alert(err?.detail || "현재 학기 지정 실패");
    }
  };

  const remove = async (sid: number, name: string) => {
    if (!confirm(`'${name}' 학기를 삭제합니다. 시간표/명단/대회/과제/동아리 데이터가 함께 삭제됩니다. 계속하시겠습니까?`))
      return;
    try {
      await api.delete(`/api/timetable/semesters/${sid}`);
      fetchSemesters();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const runPromote = async (dryRun: boolean) => {
    if (!fromSid || !toSid) {
      alert("이전 학기와 대상 학기를 선택하세요");
      return;
    }
    if (fromSid === toSid) {
      alert("같은 학기는 선택할 수 없습니다");
      return;
    }
    setPromoting(true);
    try {
      const data = await api.post(
        `/api/timetable/semesters/${fromSid}/promote-to/${toSid}`,
        {
          dry_run: dryRun,
          promote_students: promoteStudents,
          copy_teachers: copyTeachers,
          graduate_grade: graduateGrade === "" ? null : graduateGrade,
        },
      );
      setPromotePreview(data);
      if (!dryRun) {
        alert(
          `반영 완료: 진급 ${data.promoted}, 졸업 ${data.graduated}, 교직원 복제 ${data.copied_teachers}, 스킵 ${data.skipped}`,
        );
        setShowPromote(false);
      }
    } catch (err: any) {
      alert(err?.detail || "처리 실패");
    } finally {
      setPromoting(false);
    }
  };

  const update = (k: keyof FormData, v: any) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <CalendarRange size={22} /> 학기 관리
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            학기 단위로 명단/대회/과제/동아리 데이터가 격리됩니다. 현재 학기는 ★ 표시.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowPromote(true);
              setPromotePreview(null);
              if (items.length >= 2) {
                setFromSid(items[1].id);
                setToSid(items[0].id);
              }
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            <ArrowRight size={14} />
            진급/명단 복제
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
          >
            <Plus size={14} />
            학기 생성
          </button>
        </div>
      </div>

      {/* 학기 생성/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-body font-medium text-text-primary">
                {editingId ? "학기 수정" : "학기 생성"}
              </h2>
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                className="text-text-tertiary hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-caption text-text-secondary mb-1">학년도 *</label>
                <input
                  type="number"
                  value={form.year}
                  onChange={(e) => update("year", parseInt(e.target.value))}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">학기 *</label>
                <select
                  value={form.semester}
                  onChange={(e) => update("semester", parseInt(e.target.value))}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  <option value={1}>1학기</option>
                  <option value={2}>2학기</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">표시명</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder={`${form.year}학년도 ${form.semester}학기 (비우면 자동)`}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">시작일 *</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => update("start_date", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">종료일 *</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => update("end_date", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                />
              </div>
              {!editingId && (
                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-body text-text-primary">
                    <input
                      type="checkbox"
                      checked={form.is_current}
                      onChange={(e) => update("is_current", e.target.checked)}
                    />
                    생성과 동시에 현재 학기로 지정
                  </label>
                </div>
              )}
            </div>

            {/* 명단 CSV — 학기 생성과 함께 업로드 (선택). 교사/학생 한 곳에서 받음. */}
            <div className="mt-5 pt-4 border-t border-border-default">
              <h3 className="text-body font-medium text-text-primary mb-2 flex items-center gap-2">
                <Upload size={14} /> 명단 CSV (선택)
              </h3>
              <div className="text-caption text-text-tertiary mb-3 space-y-0.5">
                <div>• <b>이름</b> = 아이디 자동 부여 (동명이인은 <code>홍길동_2</code>)</div>
                <div>• <b>휴대폰 숫자</b> = 초기 비밀번호. 첫 로그인 시 변경 강제.</div>
                <div>• 교사의 <b>담당 과목·학년·학급</b>은 본인이 첫 로그인 시 드롭다운으로 입력합니다 (학교 구조 설정 필요).</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* 교직원 CSV */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-caption text-text-secondary">
                      교직원 (부서, 이름, 핸드폰)
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => downloadTemplate("teacher", false)}
                        className="inline-flex items-center gap-1 text-caption text-accent hover:underline"
                      >
                        <Download size={12} /> 최소
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadTemplate("teacher", true)}
                        className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-accent hover:underline"
                        title="담임/수업 학년 등 모든 컬럼 포함"
                      >
                        <Download size={12} /> 전체
                      </button>
                    </div>
                  </div>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setTeacherFile(e.target.files?.[0] || null)}
                    className="w-full text-caption"
                  />
                  {teacherFile && (
                    <div className="text-caption text-text-tertiary truncate">
                      📎 {teacherFile.name}
                    </div>
                  )}
                </div>

                {/* 학생 CSV */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-caption text-text-secondary">
                      학생 (학번, 이름, 핸드폰)
                    </label>
                    <button
                      type="button"
                      onClick={() => downloadTemplate("student")}
                      className="inline-flex items-center gap-1 text-caption text-accent hover:underline"
                    >
                      <Download size={12} /> 양식
                    </button>
                  </div>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setStudentFile(e.target.files?.[0] || null)}
                    className="w-full text-caption"
                  />
                  {studentFile && (
                    <div className="text-caption text-text-tertiary truncate">
                      📎 {studentFile.name}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 결과 표시 */}
            {createResult && (
              <div className="mt-4 p-3 rounded border border-border-default bg-bg-secondary space-y-2">
                {createResult.error && (
                  <div className="text-caption text-status-error flex items-start gap-1.5">
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    {createResult.error}
                  </div>
                )}
                {createResult.semester && (
                  <div className="text-caption text-text-primary">
                    ✅ <b>{createResult.semester.name}</b> 학기 생성 완료
                  </div>
                )}
                {createResult.teacher && (
                  <div className="text-caption text-text-secondary">
                    {createResult.teacher.error ? (
                      <span className="text-status-error">⚠️ 교직원 CSV: {createResult.teacher.error}</span>
                    ) : (
                      <>
                        ✅ 교직원: 성공 <b>{createResult.teacher.ok_count}</b> / 신규{" "}
                        <b>{createResult.teacher.created_users}</b> / 재사용{" "}
                        <b>{createResult.teacher.reused_users}</b>
                        {createResult.teacher.errors?.length > 0 && (
                          <span className="text-status-error"> · 오류 {createResult.teacher.errors.length}건</span>
                        )}
                      </>
                    )}
                  </div>
                )}
                {createResult.student && (
                  <div className="text-caption text-text-secondary">
                    {createResult.student.error ? (
                      <span className="text-status-error">⚠️ 학생 CSV: {createResult.student.error}</span>
                    ) : (
                      <>
                        ✅ 학생: 성공 <b>{createResult.student.ok_count}</b> / 신규{" "}
                        <b>{createResult.student.created_users}</b> / 재사용{" "}
                        <b>{createResult.student.reused_users}</b>
                        {createResult.student.errors?.length > 0 && (
                          <span className="text-status-error"> · 오류 {createResult.student.errors.length}건</span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setCreateResult(null);
                }}
                className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
              >
                {createResult ? "닫기" : "취소"}
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
              >
                {submitting
                  ? "처리 중..."
                  : editingId
                  ? teacherFile || studentFile
                    ? "수정 + 명단 등록"
                    : "수정"
                  : teacherFile || studentFile
                  ? "생성 + 명단 등록"
                  : "생성"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 학교 구조 설정 모달 */}
      {structureSid !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-body font-medium text-text-primary flex items-center gap-2">
                <School size={18} /> 학교 구조 설정
              </h2>
              <button
                onClick={() => setStructureSid(null)}
                className="text-text-tertiary hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-caption text-text-tertiary mb-4">
              교사가 첫 로그인 시 본인의 담당 학년/학급/과목을 입력할 때 사용할 <b>드롭다운 목록</b>을 정의합니다.
              표준화된 데이터로 수집되어 "담당 학생만 조회" 같은 정책이 정확히 작동합니다.
            </p>

            {/* 학년별 학급 수 */}
            <section className="mb-5">
              <h3 className="text-body font-medium text-text-primary mb-2">학년별 학급 수</h3>
              <div className="grid grid-cols-3 gap-3">
                {(["1", "2", "3"] as const).map((g) => (
                  <div key={g}>
                    <label className="block text-caption text-text-secondary mb-1">{g}학년</label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={structureForm.classes_per_grade[g] ?? 0}
                      onChange={(e) =>
                        setStructureForm((p) => ({
                          ...p,
                          classes_per_grade: { ...p.classes_per_grade, [g]: parseInt(e.target.value || "0") },
                        }))
                      }
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                ))}
              </div>
              <p className="text-caption text-text-tertiary mt-1">
                예: 1학년 5개 반이면 5 입력 → 드롭다운에 "1-1, 1-2, ..., 1-5" 자동 생성.
              </p>
            </section>

            {/* 개설 과목 */}
            <section className="mb-5">
              <h3 className="text-body font-medium text-text-primary mb-2">개설 과목</h3>
              <ChipInput
                items={structureForm.subjects}
                onChange={(items) => setStructureForm((p) => ({ ...p, subjects: items }))}
                placeholder="과목명 입력 후 Enter (예: 수학) — 콤마/줄바꿈 붙여넣기도 가능"
              />
              <p className="text-caption text-text-tertiary mt-1">
                {structureForm.subjects.length}개 과목 · Enter 추가 · Backspace로 마지막 삭제
              </p>
            </section>

            {/* 부서 */}
            <section className="mb-5">
              <h3 className="text-body font-medium text-text-primary mb-2">부서 목록</h3>
              <ChipInput
                items={structureForm.departments}
                onChange={(items) => setStructureForm((p) => ({ ...p, departments: items }))}
                placeholder="부서명 입력 후 Enter (예: 수학과)"
              />
              <p className="text-caption text-text-tertiary mt-1">
                {structureForm.departments.length}개 부서
              </p>
            </section>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStructureSid(null)}
                className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
              >
                취소
              </button>
              <button
                onClick={saveStructure}
                disabled={structureSaving}
                className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
              >
                {structureSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 진급/복제 마법사 */}
      {showPromote && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-body font-medium text-text-primary flex items-center gap-2">
                <ArrowRight size={18} /> 진급/명단 복제
              </h2>
              <button
                onClick={() => setShowPromote(false)}
                className="text-text-tertiary hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-caption text-text-secondary mb-4">
              이전 학기의 학생/교직원 명단을 대상 학기로 복제합니다. 학생은 학년이 +1 되고, 졸업 학년은 자동으로 졸업 처리됩니다.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-caption text-text-secondary mb-1">이전 학기 *</label>
                <select
                  value={fromSid ?? ""}
                  onChange={(e) => setFromSid(parseInt(e.target.value))}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  <option value="">선택</option>
                  {items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">대상 학기 *</label>
                <select
                  value={toSid ?? ""}
                  onChange={(e) => setToSid(parseInt(e.target.value))}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  <option value="">선택</option>
                  {items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 space-y-2 mt-2">
                <label className="flex items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    checked={promoteStudents}
                    onChange={(e) => setPromoteStudents(e.target.checked)}
                  />
                  학생 학년 +1 (진급)
                </label>
                <label className="flex items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    checked={copyTeachers}
                    onChange={(e) => setCopyTeachers(e.target.checked)}
                  />
                  교직원 명단 그대로 복제 (담임반은 미배정)
                </label>
                <label className="flex items-center gap-2 text-body">
                  졸업 학년:
                  <input
                    type="number"
                    value={graduateGrade}
                    onChange={(e) => setGraduateGrade(e.target.value === "" ? "" : parseInt(e.target.value))}
                    placeholder="3 (예: 고3)"
                    className="w-20 px-2 py-1 text-body border border-border-default rounded bg-bg-primary"
                  />
                  <span className="text-caption text-text-tertiary">이 학년은 졸업 처리</span>
                </label>
              </div>
            </div>

            {promotePreview && (
              <div className="mt-4 p-3 border border-border-default rounded bg-bg-secondary">
                <div className="flex items-center gap-2 text-caption mb-2">
                  <AlertCircle size={14} className="text-status-warning" />
                  {promotePreview.dry_run ? "미리보기 (아직 반영 안 됨)" : "반영 결과"}
                </div>
                <div className="text-body text-text-primary">
                  진급 <b>{promotePreview.promoted}</b> · 졸업 <b>{promotePreview.graduated}</b> · 교직원 복제 <b>{promotePreview.copied_teachers}</b> · 스킵 <b>{promotePreview.skipped}</b>
                </div>
                {promotePreview.plan_preview?.length > 0 && (
                  <div className="text-caption text-text-secondary mt-2 max-h-40 overflow-y-auto">
                    {promotePreview.plan_preview.slice(0, 10).map((p: any, i: number) => (
                      <div key={i}>
                        user_id={p.user_id} / role={p.role}
                        {p.from_grade !== undefined && ` / ${p.from_grade}학년→${p.to_grade ?? "졸업"}`}
                        {p.department && ` / ${p.department}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowPromote(false)}
                className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
              >
                닫기
              </button>
              <button
                onClick={() => runPromote(true)}
                disabled={promoting}
                className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
              >
                미리보기 (dry-run)
              </button>
              <button
                onClick={() => runPromote(false)}
                disabled={promoting || !promotePreview}
                className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
                title={!promotePreview ? "먼저 미리보기를 실행하세요" : ""}
              >
                {promoting ? "처리 중..." : "실제 반영"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium w-16">현재</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학기</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">기간</th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium w-32">작업</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className={`border-t border-border-default hover:bg-bg-secondary ${s.is_current ? "bg-blue-50/40" : ""}`}>
                <td className="px-4 py-2">
                  {s.is_current ? (
                    <span className="inline-flex items-center gap-1 text-caption text-accent font-medium">
                      <CheckCircle2 size={14} /> 현재
                    </span>
                  ) : (
                    <button
                      onClick={() => setCurrent(s.id)}
                      className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-accent"
                      title="현재 학기로 지정"
                    >
                      <Circle size={14} /> 지정
                    </button>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="text-body text-text-primary font-medium">{s.name}</div>
                  <div className="text-caption text-text-tertiary">{s.year}학년도 · {s.semester}학기</div>
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {s.start_date?.slice(0, 10)} ~ {s.end_date?.slice(0, 10)}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => openStructure(s)}
                      title="학교 구조 설정 (학급 수·과목·부서)"
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent"
                    >
                      <School size={14} />
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      title="수정"
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(s.id, s.name)}
                      title="삭제"
                      disabled={s.is_current}
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-status-error disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : "학기가 없습니다. '학기 생성'으로 추가하세요."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
