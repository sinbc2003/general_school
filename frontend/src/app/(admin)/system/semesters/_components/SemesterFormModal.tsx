"use client";

/**
 * 학기 생성·수정 모달.
 *
 * - 신규 생성 시 이전 학기 데이터 복사 옵션 (명단/동아리/구조/직책 권한)
 * - 명단 CSV 동시 업로드 (교사·학생 각각 — 선택)
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import {
  AlertCircle,
  Download,
  Upload,
  X,
} from "lucide-react";
import type { Semester } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface FormData {
  year: number;
  semester: number;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  copy_from_semester_id: number | null;
  copy_enrollments: boolean;
  copy_clubs: boolean;
  copy_structure: boolean;
  copy_positions: boolean;
}

const EMPTY_FORM: FormData = {
  year: new Date().getFullYear(),
  semester: 1,
  name: "",
  start_date: "",
  end_date: "",
  is_current: false,
  copy_from_semester_id: null,
  copy_enrollments: true,
  copy_clubs: true,
  copy_structure: true,
  copy_positions: true,
};

interface CreateResult {
  semester?: Semester;
  teacher?: any;
  student?: any;
  error?: string;
}

interface Props {
  open: boolean;
  editingId: number | null;
  editingSemester: Semester | null;  // 수정 모드일 때 prefill용
  items: Semester[];
  onClose: () => void;
  onSaved: () => void;
}

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

export function SemesterFormModal({ open, editingId, editingSemester, items, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [teacherFile, setTeacherFile] = useState<File | null>(null);
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // open or editing target 바뀔 때 form 초기화
  useEffect(() => {
    if (!open) return;
    if (editingId && editingSemester) {
      setForm({
        year: editingSemester.year,
        semester: editingSemester.semester,
        name: editingSemester.name,
        start_date: editingSemester.start_date.slice(0, 10),
        end_date: editingSemester.end_date.slice(0, 10),
        is_current: editingSemester.is_current,
        copy_from_semester_id: null,
        copy_enrollments: true,
        copy_clubs: true,
        copy_structure: true,
        copy_positions: true,
      });
    } else {
      // 신규 생성: 직전 학기를 명단 복사 원본으로 자동 선택 (carry-over 편의 — 그냥 생성해도 명단 따라옴)
      const latest = [...items].sort((a, b) => (b.year - a.year) || (b.semester - a.semester))[0];
      setForm({ ...EMPTY_FORM, copy_from_semester_id: latest?.id ?? null });
    }
    setTeacherFile(null);
    setStudentFile(null);
    setCreateResult(null);
  }, [open, editingId, editingSemester, items]);

  if (!open) return null;

  const update = (k: keyof FormData, v: any) => setForm((p) => ({ ...p, [k]: v }));

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
      if (!editingId && form.copy_from_semester_id) {
        body.copy_from_semester_id = form.copy_from_semester_id;
        body.copy_enrollments = form.copy_enrollments;
        body.copy_clubs = form.copy_clubs;
        body.copy_structure = form.copy_structure;
        body.copy_positions = form.copy_positions;
      }

      let sid: number;
      let semObj: Semester | undefined;
      if (editingId) {
        await api.put(`/api/timetable/semesters/${editingId}`, body);
        sid = editingId;
      } else {
        semObj = await api.post<Semester>("/api/timetable/semesters", body);
        sid = semObj.id;
      }

      const result: CreateResult = { semester: semObj };
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

      onSaved();

      const hadCsv = !!teacherFile || !!studentFile;
      if (!hadCsv) {
        onClose();
      }
    } catch (err: any) {
      setCreateResult({ error: err?.detail || err?.message || "저장 실패" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body font-medium text-text-primary">
            {editingId ? "학기 수정" : "학기 생성"}
          </h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
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

        {/* 이전 학기 데이터 복사 — 학기 신규 생성 시만 */}
        {!editingId && items.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border-default">
            <h3 className="text-body font-medium text-text-primary mb-2">
              이전 학기 데이터 복사 (선택)
            </h3>
            <p className="text-caption text-text-tertiary mb-3">
              학급·동아리·교직원 명단 등 거의 비슷한 경우 이전 학기를 가져와 시작.
              선택과목 등 달라진 부분만 수정하면 됨. transferred/graduated 상태는 자동 제외.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-caption text-text-secondary mb-1">복사 출처 학기</label>
                <select
                  value={form.copy_from_semester_id ?? ""}
                  onChange={(e) => update("copy_from_semester_id", e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  <option value="">— 복사하지 않음 (빈 학기) —</option>
                  {items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.year}-{s.semester})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-caption text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.copy_enrollments}
                    onChange={(e) => update("copy_enrollments", e.target.checked)}
                    disabled={!form.copy_from_semester_id}
                  />
                  학생·교직원 명단
                </label>
                <label className="flex items-center gap-2 text-caption text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.copy_clubs}
                    onChange={(e) => update("copy_clubs", e.target.checked)}
                    disabled={!form.copy_from_semester_id}
                  />
                  동아리 + 멤버
                </label>
                <label className="flex items-center gap-2 text-caption text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.copy_structure}
                    onChange={(e) => update("copy_structure", e.target.checked)}
                    disabled={!form.copy_from_semester_id}
                  />
                  학교 구조 (학급 수·교과·부서)
                </label>
                <label className="flex items-center gap-2 text-caption text-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.copy_positions}
                    onChange={(e) => update("copy_positions", e.target.checked)}
                    disabled={!form.copy_from_semester_id || !form.copy_enrollments}
                  />
                  직책·업무분장 권한
                  <span
                    className="text-text-tertiary"
                    title="업무분장은 학년도 단위 — 1학기→2학기는 그대로 가져옴. 새 학년도(다음 1학기) 시작 시에는 해제 권장."
                  >
                    ⓘ
                  </span>
                </label>
              </div>
            </div>
            {form.copy_from_semester_id && (() => {
              const src = items.find((s) => s.id === form.copy_from_semester_id);
              if (!src) return null;
              const isNewYear = src.year !== form.year;
              if (isNewYear && form.copy_positions) {
                return (
                  <div className="mt-2 p-2 bg-cream-100 border border-cream-300 rounded text-caption text-text-secondary">
                    ⚠ <b>학년도가 바뀌었습니다</b> ({src.year} → {form.year}).
                    업무분장이 재배정되는 경우가 많으므로 <b>'직책·업무분장 권한'을 해제</b>하는 것이 안전합니다.
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}

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
            onClick={onClose}
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
  );
}
