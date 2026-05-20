"use client";

/**
 * 인사이동 모달 — lifecycle_status 변경 + (선택) 자료 후임자 이관.
 *
 * 흐름:
 *  1. lifecycle_status 선택 (active/departed/graduated/transferred)
 *  2. (departed/graduated/transferred일 때) "자료 후임자에게 이관" 토글
 *  3. 후임자 선택 (필요 시)
 *  4. "적용" → PATCH /lifecycle + POST /transfer-ownership
 */

import { useState } from "react";
import { X, UserX, ArrowRight, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/client";
import type { UserItem } from "@/types";

const LIFECYCLE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "active", label: "재직/재학", hint: "정상 활동" },
  { value: "departed", label: "전출/퇴직 (교사)", hint: "자료 영구 보존" },
  { value: "graduated", label: "졸업 (학생)", hint: "자료 영구 보존" },
  { value: "transferred", label: "전학 (학생)", hint: "자료 영구 보존" },
];

export function LifecycleModal({
  user,
  allUsers,
  onClose,
  onSaved,
}: {
  user: UserItem;
  allUsers: UserItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lifecycle, setLifecycle] = useState<string>("departed");
  const [disableAccount, setDisableAccount] = useState(true);
  const [doTransfer, setDoTransfer] = useState(false);
  const [successorId, setSuccessorId] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const candidateSuccessors = allUsers.filter(
    (u) => u.id !== user.id
      && u.role !== "student"
      && (u.status === "approved" || !u.status),
  );

  const apply = async () => {
    setBusy(true);
    try {
      // 1) lifecycle 변경
      await api.patch(`/api/users/${user.id}/lifecycle`, {
        lifecycle_status: lifecycle,
        disable_account: disableAccount,
      });
      // 2) 자료 이관 (옵션)
      let transferMsg = "";
      if (doTransfer && successorId > 0) {
        const r = await api.post<{ transferred_count: number; transferred_bytes: number }>(
          `/api/users/${user.id}/transfer-ownership`,
          {
            successor_user_id: successorId,
            types: ["docs", "sheets", "decks", "surveys"],
            include_trash: false,
          },
        );
        transferMsg = `\n자료 ${r.transferred_count}건 이관 (${Math.round(r.transferred_bytes/1024/1024)}MB)`;
      }
      alert(`✓ 인사이동 적용됨${transferMsg}`);
      onSaved();
    } catch (e: any) {
      alert(e?.message || "적용 실패");
    } finally { setBusy(false); }
  };

  const willDisable = disableAccount && lifecycle !== "active";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-xl">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <h2 className="text-body font-semibold flex items-center gap-2">
            <UserX size={16} /> 인사이동 — {user.name}
          </h2>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 대상 정보 */}
          <div className="bg-bg-secondary/40 border border-border-default rounded p-3 text-[12px]">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-text-tertiary">이메일:</span> {user.email}</div>
              <div><span className="text-text-tertiary">역할:</span> {user.role}</div>
              {user.grade && (
                <div><span className="text-text-tertiary">학년:</span> {user.grade}-{user.class_number}-{user.student_number}</div>
              )}
              {user.department && (
                <div><span className="text-text-tertiary">부서:</span> {user.department}</div>
              )}
            </div>
          </div>

          {/* lifecycle 선택 */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-2">인사 상태</label>
            <div className="grid grid-cols-2 gap-2">
              {LIFECYCLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLifecycle(opt.value)}
                  className={`text-left px-3 py-2 rounded border ${
                    lifecycle === opt.value
                      ? "bg-accent/10 border-accent text-accent"
                      : "bg-bg-primary border-border-default hover:bg-bg-secondary"
                  }`}
                >
                  <div className="text-[13px] font-medium">{opt.label}</div>
                  <div className="text-[11px] text-text-tertiary">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 계정 비활성화 옵션 */}
          {lifecycle !== "active" && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={disableAccount}
                onChange={(e) => setDisableAccount(e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <div className="text-[13px] text-text-primary">계정 비활성화 (로그인 차단)</div>
                <div className="text-[11px] text-text-tertiary">
                  체크 해제하면 lifecycle만 변경 (졸업 후 본인이 자료 확인 등에 활용)
                </div>
              </div>
            </label>
          )}

          {/* 자료 이관 옵션 */}
          {lifecycle !== "active" && (
            <div className="border-t border-border-default pt-4">
              <label className="flex items-start gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={doTransfer}
                  onChange={(e) => setDoTransfer(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-[13px] font-medium text-text-primary">자료 소유권 이관 (선택)</div>
                  <div className="text-[11px] text-text-tertiary">
                    개인 도구 자료(문서·시트·덱·설문)를 후임자에게 일괄 이관. 학교 자산은 그대로 보존됩니다.
                  </div>
                </div>
              </label>
              {doTransfer && (
                <div className="ml-6">
                  <label className="block text-[11px] text-text-secondary mb-1">후임자 선택</label>
                  <select
                    value={successorId}
                    onChange={(e) => setSuccessorId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
                  >
                    <option value={0}>— 선택 —</option>
                    {candidateSuccessors.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email}) · {u.role}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* 경고 */}
          {willDisable && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5" />
              <div className="text-[12px] text-amber-900">
                <strong>{user.name}</strong>의 계정이 즉시 로그인 차단됩니다. 본인이 자료를 export 받아야 한다면 먼저 안내한 후 진행하세요.
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border-default flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] border border-border-default rounded">
            취소
          </button>
          <button
            onClick={apply}
            disabled={busy || (doTransfer && successorId === 0)}
            className="px-4 py-1.5 text-[12px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
          >
            <ArrowRight size={13} /> {busy ? "적용 중..." : "적용"}
          </button>
        </div>
      </div>
    </div>
  );
}
