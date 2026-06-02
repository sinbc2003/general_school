"use client";

import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/client";
import type { UserItem } from "@/types";

type Mode = "disable" | "delete" | "purge";

const OPTIONS: { value: Mode; label: string; desc: string; danger: boolean }[] = [
  {
    value: "disable",
    label: "비활성화 (정지)",
    desc: "로그인만 차단합니다. 데이터는 전부 보존되며 나중에 다시 활성화할 수 있습니다.",
    danger: false,
  },
  {
    value: "delete",
    label: "계정 삭제",
    desc: "계정과 개인 데이터(드라이브·과제 제출물·포트폴리오·수강·알림·소유 강좌 등)를 영구 삭제합니다. 공유 공간의 글·댓글은 작성자 표시만 비워진 채 남습니다.",
    danger: true,
  },
  {
    value: "purge",
    label: "계정 + 작성 콘텐츠 모두 삭제",
    desc: "위에 더해, 본인이 올린 공지·클래스룸 글·댓글·업로드 문서·설문 응답까지 영구 삭제합니다. (선배연구·과제·대회 등 기관 자료는 보존)",
    danger: true,
  },
];

export function DangerZoneModal({
  user,
  onClose,
  onDone,
}: {
  user: UserItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("disable");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const opt = OPTIONS.find((o) => o.value === mode)!;
  const needConfirm = opt.danger;
  const confirmOk = !needConfirm || confirmText.trim() === user.name;

  const run = async () => {
    if (!confirmOk) {
      setError(`확인을 위해 이름 "${user.name}"을(를) 정확히 입력하세요.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.delete(`/api/users/${user.id}?mode=${mode}`);
      onDone();
      onClose();
    } catch (e: any) {
      setError(e?.detail || e?.message || "처리 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-body font-semibold text-red-600 flex items-center gap-2">
            <AlertTriangle size={16} /> 계정 삭제 — {user.name}
          </h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`block border rounded-lg p-3 cursor-pointer transition-colors ${
                mode === o.value
                  ? o.danger
                    ? "border-red-400 bg-red-50/60"
                    : "border-accent bg-accent/5"
                  : "border-border-default hover:bg-bg-secondary"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="delmode"
                  checked={mode === o.value}
                  onChange={() => {
                    setMode(o.value);
                    setConfirmText("");
                    setError("");
                  }}
                />
                <span className={`text-body font-medium ${o.danger ? "text-red-600" : "text-text-primary"}`}>
                  {o.label}
                </span>
              </div>
              <p className="text-caption text-text-tertiary mt-1 ml-6">{o.desc}</p>
            </label>
          ))}

          {needConfirm && (
            <div className="pt-2">
              <label className="text-caption text-text-secondary">
                되돌릴 수 없습니다. 확인을 위해 이름{" "}
                <strong className="text-red-600">{user.name}</strong> 을(를) 입력하세요:
              </label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary mt-1"
                placeholder={user.name}
              />
            </div>
          )}

          {error && <div className="text-caption text-status-error">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button onClick={onClose} className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary">
            취소
          </button>
          <button
            onClick={run}
            disabled={busy || !confirmOk}
            className={`px-4 py-1.5 text-caption text-white rounded disabled:opacity-50 ${
              opt.danger ? "bg-red-600 hover:bg-red-700" : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {busy ? "처리 중..." : opt.danger ? "영구 삭제" : "비활성화"}
          </button>
        </div>
      </div>
    </div>
  );
}
