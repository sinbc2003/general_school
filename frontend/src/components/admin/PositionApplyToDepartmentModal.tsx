"use client";

/**
 * 직책 템플릿을 특정 학기·부서의 모든 교직원에게 일괄 할당.
 *
 * 운영 시나리오:
 * - "수학과 전체에 동일 권한 묶음" 같은 패턴.
 * - 학년도 시작 시 빠른 셋업, 부서 개편 시 일괄 재할당.
 *
 * replace=False (디폴트): 기존 직책 유지 + 이 직책만 추가
 * replace=True: 대상 enrollment의 기존 직책 모두 삭제 후 이 직책으로 교체
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Building2, Check, X, AlertTriangle } from "lucide-react";

interface Semester {
  id: number;
  name: string;
  year: number;
  semester: number;
  is_current: boolean;
  is_archived?: boolean;
  departments?: string[];
}

interface ApplyResult {
  applied: number;
  skipped: number;
  affected_users: number;
  message?: string;
}

interface Props {
  open: boolean;
  templateId: number;
  templateName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PositionApplyToDepartmentModal({
  open, templateId, templateName, onClose, onSuccess,
}: Props) {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semId, setSemId] = useState<number | null>(null);
  const [dept, setDept] = useState("");
  const [includeRoles, setIncludeRoles] = useState<{ teacher: boolean; staff: boolean }>({
    teacher: true, staff: true,
  });
  const [replace, setReplace] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setResult(null);
      try {
        const data = await api.get<Semester[]>("/api/timetable/semesters");
        if (cancelled) return;
        // archived 학기는 차단 — 백엔드가 거부. 선택 옵션에서 제외.
        const writable = data.filter((s) => !s.is_archived);
        setSemesters(writable);
        const cur = writable.find((s) => s.is_current) || writable[0];
        if (cur) {
          setSemId(cur.id);
        }
      } catch (err: any) {
        alert(err?.detail || "학기 목록 조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const currentSemester = semesters.find((s) => s.id === semId);
  const departmentOptions = currentSemester?.departments || [];

  const apply = async () => {
    if (!semId) {
      alert("학기를 선택하세요");
      return;
    }
    if (!dept.trim()) {
      alert("부서를 입력하세요");
      return;
    }
    const roles = [
      ...(includeRoles.teacher ? ["teacher"] : []),
      ...(includeRoles.staff ? ["staff"] : []),
    ];
    if (roles.length === 0) {
      alert("최소 하나의 역할은 포함해야 합니다");
      return;
    }
    if (replace) {
      if (!confirm(
        "replace 모드 — 대상 부서의 모든 교직원 enrollment의 기존 직책이 모두 삭제됩니다.\n\n" +
        "이 직책 외 다른 직책 권한도 함께 사라집니다. 정말 진행하시겠습니까?",
      )) return;
    }
    setApplying(true);
    try {
      const res = await api.post<ApplyResult>(
        `/api/permissions/position-templates/${templateId}/apply-to-department`,
        {
          semester_id: semId,
          department: dept.trim(),
          include_roles: roles,
          replace,
        },
      );
      setResult(res);
      onSuccess?.();
    } catch (err: any) {
      alert(err?.detail || "일괄 할당 실패");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`부서에 일괄 할당: ${templateName}`}
      icon={<Building2 size={18} />}
      maxWidth="lg"
    >
      {loading ? (
        <div className="py-8 text-center text-text-tertiary">학기 목록 로딩 중...</div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 bg-cream-100 border border-cream-300 rounded text-caption text-text-secondary">
            이 직책 권한 묶음을 <b>특정 학기 + 특정 부서</b>의 모든 교직원에게 한 번에 할당합니다.
            <br />
            예: "수학과 전체" 직책 → 수학과 부서 교사 5명에게 즉시 적용.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption text-text-secondary mb-1">학기 *</label>
              <select
                value={semId ?? ""}
                onChange={(e) => setSemId(parseInt(e.target.value))}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              >
                <option value="">선택</option>
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.is_current ? " ★ 현재" : ""}
                  </option>
                ))}
              </select>
              {semesters.length === 0 && (
                <div className="text-caption text-status-warning mt-1">
                  보관되지 않은 학기가 없습니다.
                </div>
              )}
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">부서 *</label>
              {departmentOptions.length > 0 ? (
                <select
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  <option value="">선택</option>
                  {departmentOptions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  placeholder="예: 수학과 (학교 구조 미설정 시 직접 입력)"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-caption text-text-secondary mb-1">대상 역할</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-body">
                <input
                  type="checkbox"
                  checked={includeRoles.teacher}
                  onChange={(e) => setIncludeRoles((p) => ({ ...p, teacher: e.target.checked }))}
                />
                교사
              </label>
              <label className="flex items-center gap-1.5 text-body">
                <input
                  type="checkbox"
                  checked={includeRoles.staff}
                  onChange={(e) => setIncludeRoles((p) => ({ ...p, staff: e.target.checked }))}
                />
                직원
              </label>
            </div>
          </div>

          <div>
            <label className="flex items-start gap-2 cursor-pointer p-2 hover:bg-bg-secondary rounded">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-body text-text-primary flex items-center gap-1">
                  {replace && <AlertTriangle size={14} className="text-status-warning" />}
                  교체 모드 (replace)
                </div>
                <div className="text-caption text-text-tertiary">
                  {replace
                    ? "⚠ 대상 enrollment의 기존 모든 직책을 삭제하고 이 직책만 할당합니다."
                    : "기본: 기존 직책은 그대로 두고 이 직책을 추가만 합니다 (이미 있으면 skip)."}
                </div>
              </div>
            </label>
          </div>

          {result && (
            <div className="p-3 bg-bg-secondary border border-border-default rounded text-body text-text-primary">
              ✅ 적용 완료:
              <ul className="text-caption text-text-secondary mt-1 ml-4 list-disc">
                <li>새로 할당: <b>{result.applied}</b>건</li>
                <li>이미 있어서 skip: <b>{result.skipped}</b>건</li>
                <li>영향받은 사용자: <b>{result.affected_users}</b>명 (자동 로그아웃됨)</li>
                {result.message && <li>{result.message}</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <ModalFooter>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          <X size={14} /> {result ? "닫기" : "취소"}
        </button>
        {!result && (
          <button
            onClick={apply}
            disabled={applying || loading || !semId || !dept.trim()}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            <Check size={14} />
            {applying ? "적용 중..." : "일괄 할당"}
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}
