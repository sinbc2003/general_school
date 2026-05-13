"use client";

/**
 * 학기별 명단 관리 (최고관리자 전용)
 * - 학기 드롭다운 → 해당 학기의 enrollment 목록
 * - 신규 등록: 기존 사용자 중에서 선택 (또는 user_id 직접 입력)
 * - 행별 수정/삭제
 * - 상태: active / transferred / graduated / on_leave
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  UserPlus,
  Plus,
  Trash2,
  Edit3,
  GraduationCap,
  Briefcase,
  Upload,
} from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { CsvUploader, type CsvUploadResult } from "@/components/ui/CsvUploader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

interface Semester {
  id: number;
  year: number;
  semester: number;
  name: string;
  is_current: boolean;
  // 학교 구조 — 인라인 드롭다운 옵션 생성용
  classes_per_grade?: Record<string, number>;
  subjects?: string[];
  departments?: string[];
}

interface Enrollment {
  id: number;
  semester_id: number;
  user_id: number;
  role: string;
  status: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  department: string | null;
  position: string | null;
  homeroom_class: string | null;
  subhomeroom_class: string | null;
  teaching_grades: (number | string)[];
  teaching_classes: string[];
  teaching_subjects: string[];
  note: string | null;
  user: {
    id: number;
    username: string | null;
    email: string;
    name: string;
  } | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: "재학/재직",
  transferred: "전출",
  graduated: "졸업",
  on_leave: "휴학/휴직",
};

const ROLE_LABELS: Record<string, string> = {
  student: "학생",
  teacher: "교사",
  staff: "직원",
};

interface FormData {
  user_id: number | "";
  role: string;
  status: string;
  grade: number | "";
  class_number: number | "";
  student_number: number | "";
  department: string;
  position: string;
  homeroom_class: string;
  subhomeroom_class: string;
  teaching_grades: string;   // 콤마 구분 입력 ("1,2")
  teaching_classes: string;  // 콤마 구분 ("1-1,1-2")
  teaching_subjects: string; // 콤마 구분 ("수학,수학II")
  note: string;
}

const EMPTY_FORM: FormData = {
  user_id: "",
  role: "student",
  status: "active",
  grade: "",
  class_number: "",
  student_number: "",
  department: "",
  position: "",
  homeroom_class: "",
  subhomeroom_class: "",
  teaching_grades: "",
  teaching_classes: "",
  teaching_subjects: "",
  note: "",
};

export default function EnrollmentsPage() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSid, setSelectedSid] = useState<number | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // 인라인 편집 상태 — { eid: { field: value } }로 진행 중 편집 추적
  const [inlineEditCell, setInlineEditCell] = useState<{ eid: number; field: string } | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState<string>("");

  // 인라인 patch — 한 필드만 PUT
  const patchField = async (eid: number, field: string, value: string | number | null) => {
    if (!selectedSid) return;
    try {
      await api.put(`/api/timetable/semesters/${selectedSid}/enrollments/${eid}`, {
        [field]: value === "" ? null : value,
      });
      // 로컬 갱신 (낙관적)
      setEnrollments((prev) =>
        prev.map((e) => {
          if (e.id !== eid) return e;
          if (["teaching_grades", "teaching_classes", "teaching_subjects"].includes(field)) {
            const list = typeof value === "string" && value
              ? value.split(",").map((s) => s.trim()).filter(Boolean)
              : [];
            return { ...e, [field]: list };
          }
          return { ...e, [field]: value === "" ? null : value };
        }),
      );
    } catch (err: any) {
      alert(err?.detail || "수정 실패");
      fetchEnrollments();  // 실패 시 서버 상태로 동기화
    }
  };

  const startInlineEdit = (eid: number, field: string, currentValue: any) => {
    setInlineEditCell({ eid, field });
    setInlineEditValue(currentValue == null ? "" : String(currentValue));
  };

  const commitInlineEdit = async () => {
    if (!inlineEditCell) return;
    const { eid, field } = inlineEditCell;
    setInlineEditCell(null);
    // 숫자 필드는 number로 변환
    let v: any = inlineEditValue.trim();
    if (["grade", "class_number", "student_number"].includes(field)) {
      v = v ? parseInt(v) : null;
    }
    await patchField(eid, field, v);
  };

  // 인라인 셀 컴포넌트 — text/number 또는 select 모드
  const InlineCell = ({
    eid, field, value, placeholder, type = "text", width = "w-20", options,
  }: {
    eid: number; field: string; value: any;
    placeholder?: string; type?: string; width?: string;
    /** 지정 시 select 모드 (드롭다운) */
    options?: Array<{ value: string; label: string }>;
  }) => {
    const isEditing = inlineEditCell?.eid === eid && inlineEditCell?.field === field;
    if (isEditing) {
      if (options) {
        return (
          <select
            value={inlineEditValue}
            onChange={(e) => setInlineEditValue(e.target.value)}
            onBlur={commitInlineEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
              if (e.key === "Escape") setInlineEditCell(null);
            }}
            autoFocus
            className={`${width} px-1 py-0.5 text-caption border border-accent rounded bg-bg-primary`}
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );
      }
      return (
        <input
          type={type}
          value={inlineEditValue}
          onChange={(e) => setInlineEditValue(e.target.value)}
          onBlur={commitInlineEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setInlineEditCell(null);
          }}
          autoFocus
          placeholder={placeholder}
          className={`${width} px-1 py-0.5 text-caption border border-accent rounded bg-bg-primary`}
        />
      );
    }
    const rawDisplay = Array.isArray(value)
      ? value.join(",")
      : value != null && value !== ""
      ? String(value)
      : "";
    // select 모드면 옵션 라벨로 표시
    let display = rawDisplay;
    if (options && rawDisplay) {
      const opt = options.find((o) => o.value === rawDisplay);
      if (opt) display = opt.label;
    }
    return (
      <button
        onClick={() => startInlineEdit(eid, field, Array.isArray(value) ? value.join(",") : value)}
        className={`${width} text-left px-1 py-0.5 text-caption rounded hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors`}
        title="클릭해서 편집"
      >
        {display || <span className="text-text-tertiary">{placeholder || "—"}</span>}
      </button>
    );
  };

  // 현재 선택된 학기의 학교 구조 → 드롭다운 옵션
  const currentSemester = semesters.find((s) => s.id === selectedSid);
  const cpg = currentSemester?.classes_per_grade || {};
  const gradeOptions: Array<{ value: string; label: string }> = Object.keys(cpg)
    .sort()
    .map((g) => ({ value: g, label: `${g}학년` }));
  // 특정 학년의 반 옵션
  const classOptionsFor = (grade: number | null | undefined): Array<{ value: string; label: string }> => {
    if (!grade) return [];
    const n = cpg[String(grade)] || 0;
    return Array.from({ length: n }, (_, i) => ({ value: String(i + 1), label: `${i + 1}반` }));
  };
  const departmentOptions: Array<{ value: string; label: string }> = (currentSemester?.departments || []).map(
    (d) => ({ value: d, label: d }),
  );
  // 전체 학급 옵션 ("1-1","1-2","2-1",...) — 담임/부담임 드롭다운용
  const allClassOptions: Array<{ value: string; label: string }> = Object.entries(cpg)
    .flatMap(([g, n]) => Array.from({ length: n }, (_, i) => `${g}-${i + 1}`))
    .map((c) => ({ value: c, label: c }));

  // CSV 업로드 상태 — 모달 표시 여부 + 대상 role만 관리. 업로드 로직은 CsvUploader가 담당.
  const [showUpload, setShowUpload] = useState(false);
  const [uploadRole, setUploadRole] = useState<"teacher" | "student">("teacher");

  const downloadTemplate = async (role: "teacher" | "student") => {
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/timetable/enrollments/csv-template/${role}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("template download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${role}_template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("템플릿 다운로드 실패: " + (err?.message || ""));
    }
  };

  const uploadCsv = async (file: File, dryRun: boolean): Promise<CsvUploadResult> => {
    if (!selectedSid) throw new Error("학기를 먼저 선택하세요");
    const token = localStorage.getItem("access_token");
    const fd = new FormData();
    fd.append("file", file);
    const url = `${API_URL}/api/timetable/semesters/${selectedSid}/import-enrollments?role=${uploadRole}&dry_run=${dryRun ? "true" : "false"}`;
    const res = await fetch(url, {
      method: "POST",
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "업로드 실패");
    return data;
  };

  useEffect(() => {
    api.get<Semester[]>("/api/timetable/semesters").then((data) => {
      setSemesters(data);
      const cur = data.find((s) => s.is_current) || data[0];
      if (cur) setSelectedSid(cur.id);
    });
  }, []);

  const fetchEnrollments = useCallback(async () => {
    if (!selectedSid) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);
      const url = `/api/timetable/semesters/${selectedSid}/enrollments${
        params.toString() ? `?${params}` : ""
      }`;
      const data = await api.get<Enrollment[]>(url);
      setEnrollments(data);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "명단 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [selectedSid, roleFilter, statusFilter]);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (e: Enrollment) => {
    setEditingId(e.id);
    setForm({
      user_id: e.user_id,
      role: e.role,
      status: e.status,
      grade: e.grade ?? "",
      class_number: e.class_number ?? "",
      student_number: e.student_number ?? "",
      department: e.department ?? "",
      position: e.position ?? "",
      homeroom_class: e.homeroom_class ?? "",
      subhomeroom_class: e.subhomeroom_class ?? "",
      teaching_grades: (e.teaching_grades || []).join(","),
      teaching_classes: (e.teaching_classes || []).join(","),
      teaching_subjects: (e.teaching_subjects || []).join(","),
      note: e.note ?? "",
    });
    setShowForm(true);
  };

  const submit = async () => {
    if (!selectedSid) return;
    if (!editingId && !form.user_id) {
      alert("등록할 사용자 ID를 입력하세요");
      return;
    }
    setSubmitting(true);
    try {
      const body: any = {
        role: form.role,
        status: form.status,
        grade: form.grade === "" ? null : form.grade,
        class_number: form.class_number === "" ? null : form.class_number,
        student_number: form.student_number === "" ? null : form.student_number,
        department: form.department || null,
        position: form.position || null,
        homeroom_class: form.homeroom_class || null,
        subhomeroom_class: form.subhomeroom_class || null,
        teaching_grades: form.teaching_grades || null,
        teaching_classes: form.teaching_classes || null,
        teaching_subjects: form.teaching_subjects || null,
        note: form.note || null,
      };
      if (editingId) {
        await api.put(`/api/timetable/semesters/${selectedSid}/enrollments/${editingId}`, body);
      } else {
        body.user_id = form.user_id;
        await api.post(`/api/timetable/semesters/${selectedSid}/enrollments`, body);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      fetchEnrollments();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (eid: number, name: string) => {
    if (!selectedSid) return;
    if (!confirm(`'${name}'님을 이 학기 명단에서 제외합니다. 계속하시겠습니까?`)) return;
    try {
      await api.delete(`/api/timetable/semesters/${selectedSid}/enrollments/${eid}`);
      fetchEnrollments();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const update = (k: keyof FormData, v: any) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <UserPlus size={22} /> 학기별 명단
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            <b>표의 셀을 클릭해서 바로 편집</b>할 수 있습니다 (Enter 저장 · Esc 취소). 학급 변경/담임 교체 등 학기 도중 수정 OK.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowUpload(true);
              setUploadResult(null);
              setUploadFile(null);
            }}
            disabled={!selectedSid}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
          >
            <Upload size={14} />
            CSV 일괄 등록
          </button>
          <button
            onClick={openCreate}
            disabled={!selectedSid}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            <Plus size={14} />
            한 명 추가
          </button>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1">
          <label className="text-caption text-text-secondary">학기:</label>
          <select
            value={selectedSid ?? ""}
            onChange={(e) => setSelectedSid(parseInt(e.target.value))}
            className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary min-w-[200px]"
          >
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.is_current ? " ★ 현재" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-caption text-text-secondary">역할:</label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          >
            <option value="">전체</option>
            <option value="student">학생</option>
            <option value="teacher">교사</option>
            <option value="staff">직원</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-caption text-text-secondary">상태:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          >
            <option value="">전체</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <span className="text-caption text-text-tertiary ml-auto">
          총 {enrollments.length}명
        </span>
      </div>

      {/* CSV 업로드 모달 (Modal + CsvUploader 컴포넌트 사용) */}
      <Modal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="CSV 일괄 등록"
        icon={<Upload size={18} />}
        maxWidth="xl"
      >
        <div className="flex items-center gap-2 mb-3">
          <label className="text-caption text-text-secondary">대상:</label>
          <select
            value={uploadRole}
            onChange={(e) => setUploadRole(e.target.value as "teacher" | "student")}
            className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          >
            <option value="teacher">교직원 (부서, 이름, 핸드폰)</option>
            <option value="student">학생 (학번, 이름, 핸드폰)</option>
          </select>
        </div>
        <CsvUploader
          key={uploadRole /* role 바뀌면 상태 초기화 */}
          onUpload={uploadCsv}
          onTemplateDownload={() => downloadTemplate(uploadRole)}
          onSuccess={() => fetchEnrollments()}
          description={
            <>
              <div>• <b>이름</b>이 자동으로 <b>아이디</b>가 됩니다 (동명이인은 <code>홍길동_2</code> 자동 부여).</div>
              <div>• <b>초기 비밀번호 = 휴대폰 번호</b> (숫자만, &apos;-&apos; 제거)</div>
              <div>• 첫 로그인 시 비밀번호 변경이 강제됩니다.</div>
              <div>• 이메일은 자동 생성됩니다 (<code>이름@school.local</code>).</div>
            </>
          }
          renderExtraMetrics={(r) => (
            <>
              {" · "}신규 사용자 <b>{r.created_users}</b>
              {" · "}기존 사용자 재사용 <b>{r.reused_users}</b>
              {r.enrolled !== undefined && (
                <>
                  {" · "}명단 등록 <b>{r.enrolled}</b>
                </>
              )}
            </>
          )}
        />
      </Modal>

      {/* 명단 추가/수정 모달 */}
      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingId(null);
        }}
        title={editingId ? "명단 수정" : "명단 추가"}
        maxWidth="xl"
      >
        <div className="grid grid-cols-2 gap-3">
              {!editingId && (
                <div className="col-span-2">
                  <label className="block text-caption text-text-secondary mb-1">사용자 ID *</label>
                  <input
                    type="number"
                    value={form.user_id}
                    onChange={(e) => update("user_id", e.target.value === "" ? "" : parseInt(e.target.value))}
                    placeholder="등록된 사용자 ID (사용자 관리 페이지에서 확인)"
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                  />
                  <div className="text-caption text-text-tertiary mt-1">
                    추후 사용자 검색 기능 추가 예정. 일단 사용자 관리(/users)에서 ID 확인 후 입력하세요.
                  </div>
                </div>
              )}
              <div>
                <label className="block text-caption text-text-secondary mb-1">역할 *</label>
                <select
                  value={form.role}
                  onChange={(e) => update("role", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  <option value="student">학생</option>
                  <option value="teacher">교사</option>
                  <option value="staff">직원</option>
                </select>
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">상태</label>
                <select
                  value={form.status}
                  onChange={(e) => update("status", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {form.role === "student" ? (
                <>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">학년</label>
                    <input
                      type="number"
                      value={form.grade}
                      onChange={(e) => update("grade", e.target.value === "" ? "" : parseInt(e.target.value))}
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">반</label>
                    <input
                      type="number"
                      value={form.class_number}
                      onChange={(e) => update("class_number", e.target.value === "" ? "" : parseInt(e.target.value))}
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-caption text-text-secondary mb-1">번호</label>
                    <input
                      type="number"
                      value={form.student_number}
                      onChange={(e) => update("student_number", e.target.value === "" ? "" : parseInt(e.target.value))}
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">부서</label>
                    <input
                      type="text"
                      value={form.department}
                      onChange={(e) => update("department", e.target.value)}
                      placeholder="예: 수학과"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">직위</label>
                    <input
                      type="text"
                      value={form.position}
                      onChange={(e) => update("position", e.target.value)}
                      placeholder="예: 부장, 평교사"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">담임반</label>
                    <input
                      type="text"
                      value={form.homeroom_class}
                      onChange={(e) => update("homeroom_class", e.target.value)}
                      placeholder="예: 3-2"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">부담임반</label>
                    <input
                      type="text"
                      value={form.subhomeroom_class}
                      onChange={(e) => update("subhomeroom_class", e.target.value)}
                      placeholder="예: 3-3"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">수업 학년</label>
                    <input
                      type="text"
                      value={form.teaching_grades}
                      onChange={(e) => update("teaching_grades", e.target.value)}
                      placeholder="콤마 구분, 예: 1,2,3"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">수업 학급</label>
                    <input
                      type="text"
                      value={form.teaching_classes}
                      onChange={(e) => update("teaching_classes", e.target.value)}
                      placeholder="예: 1-1,1-2,2-3 (학년만 작성하면 생략)"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-caption text-text-secondary mb-1">가르치는 과목</label>
                    <input
                      type="text"
                      value={form.teaching_subjects}
                      onChange={(e) => update("teaching_subjects", e.target.value)}
                      placeholder="콤마 구분, 예: 수학,수학I"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                    />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">비고</label>
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => update("note", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                />
              </div>
        </div>
        <ModalFooter>
          <button
            onClick={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? "저장 중..." : editingId ? "수정" : "추가"}
          </button>
        </ModalFooter>
      </Modal>

      {/* 테이블 */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">이름</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">역할</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">상태</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학년/반/번호 또는 부서/직위</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">담임/부담임</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">수업 학년/과목</th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium w-32">작업</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e) => (
              <tr key={e.id} className="border-t border-border-default hover:bg-bg-secondary">
                <td className="px-4 py-2 text-body text-text-primary">
                  <div className="flex items-center gap-2">
                    {e.role === "student" ? (
                      <GraduationCap size={14} className="text-text-tertiary flex-shrink-0" />
                    ) : (
                      <Briefcase size={14} className="text-text-tertiary flex-shrink-0" />
                    )}
                    <div>
                      <div>{e.user?.name || `user_id:${e.user_id}`}</div>
                      <div className="text-caption text-text-tertiary">{e.user?.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">{ROLE_LABELS[e.role] || e.role}</td>
                <td className="px-4 py-2 text-body text-text-secondary">{STATUS_LABELS[e.status] || e.status}</td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {e.role === "student" ? (
                    <div className="flex items-center gap-1">
                      <InlineCell
                        eid={e.id}
                        field="grade"
                        value={e.grade}
                        placeholder="학년"
                        width="w-16"
                        options={gradeOptions.length > 0 ? gradeOptions : undefined}
                        type="number"
                      />
                      <span>-</span>
                      <InlineCell
                        eid={e.id}
                        field="class_number"
                        value={e.class_number}
                        placeholder="반"
                        width="w-14"
                        options={
                          e.grade && classOptionsFor(e.grade).length > 0
                            ? classOptionsFor(e.grade)
                            : undefined
                        }
                        type="number"
                      />
                      <span>/</span>
                      <InlineCell eid={e.id} field="student_number" value={e.student_number} placeholder="번호" type="number" width="w-14" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <InlineCell
                        eid={e.id}
                        field="department"
                        value={e.department}
                        placeholder="부서"
                        width="w-28"
                        options={departmentOptions.length > 0 ? departmentOptions : undefined}
                      />
                      <span>/</span>
                      <InlineCell eid={e.id} field="position" value={e.position} placeholder="직위" width="w-20" />
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {e.role !== "student" ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-text-tertiary w-6">담임</span>
                        <InlineCell
                          eid={e.id}
                          field="homeroom_class"
                          value={e.homeroom_class}
                          placeholder="없음"
                          width="w-20"
                          options={allClassOptions.length > 0 ? allClassOptions : undefined}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-text-tertiary w-6">부</span>
                        <InlineCell
                          eid={e.id}
                          field="subhomeroom_class"
                          value={e.subhomeroom_class}
                          placeholder="없음"
                          width="w-20"
                          options={allClassOptions.length > 0 ? allClassOptions : undefined}
                        />
                      </div>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {e.role !== "student" ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-text-tertiary w-8">학년</span>
                        <InlineCell eid={e.id} field="teaching_grades" value={e.teaching_grades} placeholder="예 1,2" width="w-20" />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-text-tertiary w-8">과목</span>
                        <InlineCell eid={e.id} field="teaching_subjects" value={e.teaching_subjects} placeholder="예 수학" width="w-32" />
                      </div>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => openEdit(e)}
                      title="수정"
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(e.id, e.user?.name || `user_id:${e.user_id}`)}
                      title="삭제"
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-status-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {enrollments.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : "이 학기에 등록된 명단이 없습니다. '명단 추가'로 등록하세요."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
