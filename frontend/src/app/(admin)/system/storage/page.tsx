"use client";

/**
 * 스토리지 볼륨 관리 (`/system/storage`).
 * super_admin 전용. 외장 SSD/HDD 등록 + 사용량 모니터.
 */

import { useEffect, useState, useCallback } from "react";
import { HardDrive, Plus, RefreshCw, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface Volume {
  id: number;
  name: string;
  description: string | null;
  path: string;
  capacity_bytes: number;
  used_bytes: number;
  available_bytes: number;
  runtime_total_bytes: number | null;
  runtime_free_bytes: number | null;
  is_active: boolean;
  priority: number;
  last_status: string | null;
  last_checked_at: string | null;
}

function formatGB(bytes: number | null | undefined): string {
  if (!bytes) return "0 GB";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb < 1) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${gb.toFixed(1)} GB`;
}

export default function StorageVolumesPage() {
  const [items, setItems] = useState<Volume[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: Volume[] }>("/api/storage/volumes");
      setItems(r.items);
    } catch (e: any) {
      alert(e?.message || "불러오기 실패");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkVolume = async (id: number) => {
    try {
      await api.post(`/api/storage/volumes/${id}/check`, {});
      await load();
    } catch (e: any) {
      alert(e?.message || "체크 실패");
    }
  };

  const toggleActive = async (v: Volume) => {
    try {
      await api.put(`/api/storage/volumes/${v.id}`, { is_active: !v.is_active });
      await load();
    } catch (e: any) {
      alert(e?.message || "변경 실패");
    }
  };

  const remove = async (v: Volume) => {
    if (!confirm(`"${v.name}" 볼륨을 삭제합니다. 기존 파일은 그대로 남지만 새 업로드 분산 대상에서 제외됩니다.`)) return;
    try {
      await api.delete(`/api/storage/volumes/${v.id}`);
      await load();
    } catch (e: any) {
      alert(e?.message || "삭제 실패");
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <HardDrive size={20} className="text-text-primary" />
            <h1 className="text-title text-text-primary">스토리지 볼륨</h1>
          </div>
          <p className="text-caption text-text-tertiary">
            외장 SSD/HDD 등록. 새 업로드는 active 볼륨 중 우선순위 + 여유 용량 기준으로 자동 분산됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="px-3 py-2 text-[12px] bg-accent text-white rounded hover:opacity-90 flex items-center gap-1"
        >
          <Plus size={13} /> 볼륨 추가
        </button>
      </div>

      {/* 안내 */}
      <div className="bg-cream-100 border border-cream-200 rounded-lg p-4 mb-5">
        <h3 className="text-body font-semibold text-text-primary mb-2">셋업 절차</h3>
        <ol className="text-[13px] text-text-secondary space-y-1.5 list-decimal ml-4">
          <li>외장 SSD/HDD를 노트북에 꽂고 마운트 (Linux: <code className="bg-bg-secondary px-1 rounded">/mnt/external1</code> 등)</li>
          <li>backend 프로세스가 해당 경로에 쓰기 권한이 있는지 확인 (chmod / chown)</li>
          <li>"볼륨 추가"로 등록 — 경로 + 표시명 + 용량 (선택)</li>
          <li>"체크" 버튼으로 mount 상태 확인 (mounted/missing/error)</li>
          <li>active 토글로 새 업로드 받기 시작</li>
        </ol>
      </div>

      {showCreate && <CreateVolumeModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}

      {loading ? (
        <div className="text-text-tertiary">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <HardDrive size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">등록된 볼륨이 없습니다</div>
          <div className="text-caption text-text-tertiary mt-1">
            현재는 backend/storage 단일 디렉터리 사용 중. 외장 SSD 추가 시 위 "볼륨 추가" 클릭.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((v) => {
            const total = v.runtime_total_bytes || v.capacity_bytes || 0;
            const used = total - (v.runtime_free_bytes ?? 0);
            const ratio = total > 0 ? used / total : 0;
            const barColor = ratio >= 0.9 ? "#dc2626" : ratio >= 0.8 ? "#f59e0b" : "#3b82f6";
            return (
              <div key={v.id} className="bg-bg-primary border border-border-default rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-body font-semibold text-text-primary">{v.name}</span>
                      {v.is_active ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">active</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">disabled</span>
                      )}
                      {v.last_status === "mounted" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600">
                          <CheckCircle2 size={10} /> mounted
                        </span>
                      )}
                      {v.last_status && v.last_status !== "mounted" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600">
                          <AlertTriangle size={10} /> {v.last_status}
                        </span>
                      )}
                      <span className="text-[11px] text-text-tertiary">우선순위 {v.priority}</span>
                    </div>
                    <code className="text-[11px] text-text-tertiary block mt-1">{v.path}</code>
                    {v.description && (
                      <div className="text-[12px] text-text-secondary mt-1">{v.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => checkVolume(v.id)}
                      className="p-1.5 rounded hover:bg-bg-secondary text-text-tertiary"
                      title="헬스체크"
                    >
                      <RefreshCw size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(v)}
                      className="px-2 py-1 text-[11px] border border-border-default rounded hover:bg-bg-secondary"
                    >
                      {v.is_active ? "비활성화" : "활성화"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(v)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-500"
                      title="삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* 사용량 게이지 */}
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[11px] text-text-tertiary">
                    {formatGB(used)} / {formatGB(total)}
                  </span>
                  <span className="text-[11px] text-text-tertiary">
                    여유 {formatGB(v.runtime_free_bytes)}
                  </span>
                </div>
                <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${Math.min(100, ratio * 100)}%`, backgroundColor: barColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateVolumeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(100);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !path.trim()) {
      alert("이름과 경로는 필수입니다");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/storage/volumes", {
        name: name.trim(),
        path: path.trim(),
        description: description.trim() || null,
        priority,
      });
      onSaved();
    } catch (e: any) {
      alert(e?.message || "추가 실패");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-lg">
        <div className="px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-semibold">볼륨 추가</h2>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 외장 SSD 1TB - WD"
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">마운트 경로 *</label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/mnt/external1"
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary font-mono"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">설명 (선택)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">우선순위 (낮을수록 먼저 채움)</label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-32 px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border-default flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] border border-border-default rounded">취소</button>
          <button
            onClick={save}
            disabled={saving || !name.trim() || !path.trim()}
            className="px-4 py-1.5 text-[12px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "저장 중..." : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
