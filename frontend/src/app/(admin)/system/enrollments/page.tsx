"use client";

/**
 * 학기별 명단 관리 (최고관리자 전용)
 * - 학기 드롭다운 → 해당 학기의 enrollment 목록
 * - 신규 등록: 기존 사용자 중에서 선택 (또는 user_id 직접 입력)
 * - 행별 수정/삭제 + 셀 인라인 편집
 * - 상태: active / transferred / graduated / on_leave
 *
 * Form/CSV 모달은 _components/ 디렉토리로 분리.
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
import { InlineCell as SharedInlineCell, type InlineCellOption } from "@/components/ui/InlineCell";
import { EnrollmentPositionsModal } from "@/components/admin/EnrollmentPositionsModal";

import type { Enrollment, Semester } from "@/types";
import { EnrollmentFormModal } from "./_components/EnrollmentFormModal";
import { CsvUploadModal } from "./_components/CsvUploadModal";

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

export default function EnrollmentsPage() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSid, setSelectedSid] = useState<number | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [positionsModal, setPositionsModal] = useState<{ eid: number; name: string } | null>(null);

  // 인라인 patch — 한 필드만 PUT + 낙관적 갱신
  const patchField = async (eid: number, field: string, value: string | number | null) => {
    if (!selectedSid) return;
    await api.put(`/api/timetable/semesters/${selectedSid}/enrollments/${eid}`, {
      [field]: value === "" ? null : value,
    });
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
  };

  // 셀 보조 — 공통 SharedInlineCell 래퍼
  const Cell = ({
    eid, field, value, options, type = "text", width = "w-20", placeholder,
  }: {
    eid: number; field: string; value: any;
    options?: InlineCellOption[]; type?: "text" | "number"; width?: string; placeholder?: string;
  }) => (
    <SharedInlineCell
      value={Array.isArray(value) ? value.join(",") : value}
      options={options}
      type={type}
      width={width}
      placeholder={placeholder}
      onSave={async (raw) => {
        let v: any = raw;
        if (["grade", "class_number", "student_number"].includes(field)) {
          v = raw ? parseInt(raw) : null;
        }
        try {
          await patchField(eid, field, v);
        } catch (err: any) {
          alert(err?.detail || "수정 실패");
          fetchEnrollments();
          throw err;
        }
      }}
    />
  );

  // 현재 선택된 학기의 학교 구조 → 드롭다운 옵션
  const currentSemester = semesters.find((s) => s.id === selectedSid);
  const cpg = currentSemester?.classes_per_grade || {};
  const gradeOptions: Array<{ value: string; label: string }> = Object.keys(cpg)
    .sort()
    .map((g) => ({ value: g, label: `${g}학년` }));
  const classOptionsFor = (grade: number | null | undefined): Array<{ value: string; label: string }> => {
    if (!grade) return [];
    const n = cpg[String(grade)] || 0;
    return Array.from({ length: n }, (_, i) => ({ value: String(i + 1), label: `${i + 1}반` }));
  };
  const departmentOptions: Array<{ value: string; label: string }> = (currentSemester?.departments || []).map(
    (d) => ({ value: d, label: d }),
  );
  const allClassOptions: Array<{ value: string; label: string }> = Object.entries(cpg)
    .flatMap(([g, n]) => Array.from({ length: n }, (_, i) => `${g}-${i + 1}`))
    .map((c) => ({ value: c, label: c }));

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
      // per_page=2000 — 학교 전체 명단이 한 페이지에 들어오게 (1400명 학교 기준).
      // 더 큰 학교는 향후 페이지네이션 UI 도입.
      params.set("per_page", "2000");
      const url = `/api/timetable/semesters/${selectedSid}/enrollments?${params}`;
      const data = await api.get<{ items: Enrollment[]; total: number } | Enrollment[]>(url);
      // 백엔드 응답 호환 (list 또는 {items} 형태)
      setEnrollments(Array.isArray(data) ? data : data.items);
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

  const editingEnrollment = editingId ? enrollments.find((e) => e.id === editingId) ?? null : null;

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
            onClick={() => setShowUpload(true)}
            disabled={!selectedSid}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
          >
            <Upload size={14} />
            CSV 일괄 등록
          </button>
          <button
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
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

      <CsvUploadModal
        open={showUpload}
        semesterId={selectedSid}
        onClose={() => setShowUpload(false)}
        onSuccess={fetchEnrollments}
      />

      {positionsModal && selectedSid && (
        <EnrollmentPositionsModal
          open={true}
          semesterId={selectedSid}
          enrollmentId={positionsModal.eid}
          userName={positionsModal.name}
          onClose={() => setPositionsModal(null)}
          onSaved={fetchEnrollments}
        />
      )}

      <EnrollmentFormModal
        open={showForm}
        editingId={editingId}
        editingEnrollment={editingEnrollment}
        semesterId={selectedSid}
        existingUserIds={enrollments.map((e) => e.user_id)}
        onClose={() => {
          setShowForm(false);
          setEditingId(null);
        }}
        onSaved={fetchEnrollments}
      />

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
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium w-28">직책/권한</th>
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
                      <Cell
                        eid={e.id}
                        field="grade"
                        value={e.grade}
                        placeholder="학년"
                        width="w-16"
                        options={gradeOptions.length > 0 ? gradeOptions : undefined}
                        type="number"
                      />
                      <span>-</span>
                      <Cell
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
                      <Cell eid={e.id} field="student_number" value={e.student_number} placeholder="번호" type="number" width="w-14" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Cell
                        eid={e.id}
                        field="department"
                        value={e.department}
                        placeholder="부서"
                        width="w-28"
                        options={departmentOptions.length > 0 ? departmentOptions : undefined}
                      />
                      <span>/</span>
                      <Cell eid={e.id} field="position" value={e.position} placeholder="직위" width="w-20" />
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {e.role !== "student" ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-text-tertiary w-6">담임</span>
                        <Cell
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
                        <Cell
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
                        <Cell eid={e.id} field="teaching_grades" value={e.teaching_grades} placeholder="예 1,2" width="w-20" />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-text-tertiary w-8">과목</span>
                        <Cell eid={e.id} field="teaching_subjects" value={e.teaching_subjects} placeholder="예 수학" width="w-32" />
                      </div>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-2">
                  {e.role !== "student" ? (
                    <button
                      onClick={() =>
                        setPositionsModal({
                          eid: e.id,
                          name: e.user?.name || `user_id:${e.user_id}`,
                        })
                      }
                      className={`flex items-center gap-1 px-2 py-1 text-caption rounded border ${
                        (e.position_count ?? 0) > 0
                          ? "bg-cream-100 border-cream-300 text-text-primary hover:bg-cream-200"
                          : "border-border-default text-text-tertiary hover:bg-bg-secondary"
                      }`}
                      title="이 학기에 부여된 직책 + 권한 편집"
                    >
                      <Briefcase size={12} />
                      {(e.position_count ?? 0) > 0
                        ? `${e.position_count}개`
                        : "할당"}
                    </button>
                  ) : (
                    <span className="text-text-tertiary text-caption">-</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(e.id);
                        setShowForm(true);
                      }}
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
                <td colSpan={8} className="px-4 py-8 text-center text-body text-text-tertiary">
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
