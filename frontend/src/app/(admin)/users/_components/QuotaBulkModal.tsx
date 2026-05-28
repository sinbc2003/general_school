"use client";

/**
 * 역할별 일괄 quota 변경 모달 — super_admin 전용.
 *
 * 권한: user.manage.quota (PermissionGate로 보호).
 * 0 = 무제한 sentinel. 음수 차단. super_admin role은 일괄 변경 대상에서 제외.
 */

import { useState } from "react";
import { api } from "@/lib/api/client";

const ROLE_OPTIONS = [
  { value: "teacher", label: "교사", defaultMb: 500 },
  { value: "staff", label: "직원", defaultMb: 300 },
  { value: "student", label: "학생", defaultMb: 200 },
  { value: "designated_admin", label: "지정관리자", defaultMb: 1024 },
];

interface Props {
  onClose: () => void;
  onApplied?: () => void;
}

export function QuotaBulkModal({ onClose, onApplied }: Props) {
  const [role, setRole] = useState("student");
  const [quotaMb, setQuotaMb] = useState("200");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleRoleChange = (newRole: string) => {
    setRole(newRole);
    const opt = ROLE_OPTIONS.find((o) => o.value === newRole);
    if (opt) setQuotaMb(String(opt.defaultMb));
  };

  const handleSubmit = async () => {
    const mb = parseInt(quotaMb, 10);
    if (Number.isNaN(mb) || mb < 0) {
      alert("용량은 0 이상이어야 합니다 (0 = 무제한)");
      return;
    }
    if (!confirmed) {
      alert("이미 사용 중인 사용자의 quota도 일괄 덮어쓰기됩니다. 확인 체크 후 진행하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post("/api/users/_quota/bulk", {
        role,
        quota_mb: mb,
      });
      alert(
        `${result.affected_count}명의 ${ROLE_OPTIONS.find((o) => o.value === role)?.label} ` +
        `quota가 ${mb === 0 ? "무제한" : `${mb}MB`}로 변경됨`
      );
      onApplied?.();
      onClose();
    } catch (err: any) {
      alert(err?.detail || "일괄 변경 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-title mb-4">역할별 일괄 용량 할당</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-caption text-text-secondary mb-1">대상 역할</label>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
              disabled={submitting}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-caption text-text-tertiary mt-1">
              최고관리자(super_admin)는 일괄 변경 대상에서 제외 — 항상 무제한.
            </p>
          </div>

          <div>
            <label className="block text-caption text-text-secondary mb-1">
              할당 용량 (MB) — 0 입력 시 무제한
            </label>
            <input
              type="number"
              min={0}
              value={quotaMb}
              onChange={(e) => setQuotaMb(e.target.value)}
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
              disabled={submitting}
            />
            <p className="text-caption text-text-tertiary mt-1">
              참고: 1024MB = 1GB. 학생 200MB / 교사 500MB / 직원 300MB가 기본값.
            </p>
          </div>

          <label className="flex items-start gap-2 text-caption text-text-secondary">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span>
              이미 다른 quota가 부여된 사용자도 모두 위 값으로 덮어쓰기됨을 확인합니다.
              (used_bytes는 그대로 유지되어, 줄인 quota보다 사용량이 많으면 그 사용자는
              새 업로드만 차단됩니다 — 기존 자료는 삭제되지 않음.)
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-body border border-border-default rounded hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !confirmed}
            className="px-4 py-2 text-body bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? "적용 중..." : "일괄 적용"}
          </button>
        </div>
      </div>
    </div>
  );
}
