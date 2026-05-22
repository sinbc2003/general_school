"use client";

/**
 * 마운트 후보 자동 감지 모달.
 *
 * Backend `/api/storage/volumes/_detect` 호출 → 안전 prefix(/mnt /media /run/media)
 * 하위 마운트만 후보로 표시. 사용자가 후보 1개 선택 → 표시명 입력 → 1클릭 등록.
 *
 * 안전:
 * - 이미 등록된 path는 회색 + "등록됨" 배지 (중복 등록 차단)
 * - writable=false 후보는 빨간색 (등록 불가)
 * - recommended=true 후보만 기본 강조 (1 GB+ + writable + 미등록)
 */

import { useEffect, useState } from "react";
import { HardDrive, Loader2, RefreshCw, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface Candidate {
  path: string;
  fstype: string;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  writable: boolean;
  already_registered: boolean;
  recommended: boolean;
}

function formatGB(bytes: number): string {
  if (!bytes) return "0 GB";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb < 1) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${gb.toFixed(1)} GB`;
}

export default function DetectMountsModal({
  onClose,
  onRegistered,
}: {
  onClose: () => void;
  onRegistered: () => void;
}) {
  const [items, setItems] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ items: Candidate[] }>("/api/storage/volumes/_detect");
      setItems(r.items);
    } catch (e: any) {
      setError(e?.message || "감지 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const register = async (c: Candidate) => {
    if (c.already_registered || !c.writable) return;
    const defaultName = c.path.split("/").filter(Boolean).join("-");
    const name = prompt(
      `이 볼륨을 어떤 이름으로 등록할까요?\n경로: ${c.path}\n용량: ${formatGB(c.total_bytes)}`,
      defaultName,
    );
    if (!name || !name.trim()) return;
    setRegistering(c.path);
    setError(null);
    try {
      await api.post("/api/storage/volumes", {
        name: name.trim(),
        path: c.path,
        capacity_bytes: c.total_bytes,
        description: `자동 감지 (${c.fstype})`,
      });
      onRegistered();
    } catch (e: any) {
      setError(e?.message || "등록 실패");
    } finally {
      setRegistering(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <HardDrive size={18} className="text-accent" />
            <h2 className="text-body font-semibold text-text-primary">마운트 자동 감지</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="p-1.5 text-text-tertiary hover:bg-bg-secondary rounded"
              title="다시 감지"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-text-tertiary hover:bg-bg-secondary rounded"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-5 py-2 bg-cream-100 border-b border-border-default text-[12px] text-text-secondary">
          <code className="bg-bg-secondary px-1 rounded">/mnt</code>{" "}
          <code className="bg-bg-secondary px-1 rounded">/media</code>{" "}
          <code className="bg-bg-secondary px-1 rounded">/run/media</code>{" "}
          하위만 표시. tmpfs/proc/sysfs 등 시스템 마운트는 자동 제외 됩니다.
        </div>

        {error && (
          <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded px-3 py-2 text-[12px] text-red-700 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <div className="text-center py-10 text-text-tertiary">
              <Loader2 size={20} className="animate-spin mx-auto mb-2" />
              마운트 스캔 중...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-text-tertiary">
              <div className="text-body">감지된 외부 마운트가 없습니다</div>
              <div className="text-[12px] mt-1">
                외장 SSD/HDD를 노트북에 꽂고 <code className="bg-bg-secondary px-1 rounded">/mnt</code>에 마운트 후 다시 감지.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((c) => {
                const usedRatio = c.total_bytes > 0 ? c.used_bytes / c.total_bytes : 0;
                const disabled = c.already_registered || !c.writable;
                return (
                  <div
                    key={c.path}
                    className={`border rounded p-3 flex items-center gap-3 ${
                      c.already_registered
                        ? "border-border-default bg-bg-secondary opacity-60"
                        : !c.writable
                        ? "border-red-200 bg-red-50"
                        : c.recommended
                        ? "border-accent bg-accent/5"
                        : "border-border-default"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <code className="text-[13px] font-mono text-text-primary">{c.path}</code>
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded">
                          {c.fstype}
                        </span>
                        {c.recommended && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">
                            추천
                          </span>
                        )}
                        {c.already_registered && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded">
                            등록됨
                          </span>
                        )}
                        {!c.writable && !c.already_registered && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                            read-only
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[12px] text-text-tertiary">
                        <span>{formatGB(c.used_bytes)} 사용 / {formatGB(c.total_bytes)} 전체</span>
                        <span>여유 {formatGB(c.free_bytes)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 bg-bg-secondary rounded overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, usedRatio * 100)}%`,
                            background:
                              usedRatio >= 0.9 ? "#dc2626" : usedRatio >= 0.8 ? "#f59e0b" : "#3b82f6",
                          }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => register(c)}
                      disabled={disabled || registering === c.path}
                      className={`px-3 py-1.5 text-[12px] rounded ${
                        disabled
                          ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                          : "bg-accent text-white hover:opacity-90"
                      }`}
                    >
                      {registering === c.path
                        ? "등록 중..."
                        : c.already_registered
                        ? "등록됨"
                        : !c.writable
                        ? "쓰기 불가"
                        : "+ 등록"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border-default text-[11px] text-text-tertiary bg-cream-100">
          <CheckCircle2 size={11} className="inline mr-1" />
          시스템 디렉토리(/proc /sys /tmp 등)는 자동으로 제외됩니다. 등록 후
          <code className="bg-bg-secondary px-1 rounded ml-1">active</code> 토글로 새 업로드 받기 시작.
        </div>
      </div>
    </div>
  );
}
