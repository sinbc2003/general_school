"use client";

/**
 * 드라이브 활동 로그 모달 — 본인 드라이브 관련 audit_log 노출.
 *
 * GET /api/drive/activity 호출 → 최근 50건. 자료 이동/이름변경/삭제/AI 정리/백업 등
 * 사용자가 직접 확인하고 의심스러운 변화 추적 가능.
 */

import { useEffect, useState } from "react";
import { X, Activity, FileText, FolderPlus, Pencil, Trash2, RotateCcw, Sparkles, Download, Upload } from "lucide-react";
import { api } from "@/lib/api/client";

interface ActivityItem {
  id: number;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string | null;
}

interface Props {
  onClose: () => void;
}

const ACTION_META: Record<string, { icon: any; label: string; color: string }> = {
  "drive.folder.create": { icon: FolderPlus, label: "폴더 생성", color: "text-amber-600" },
  "drive.folder.update": { icon: Pencil, label: "폴더 수정", color: "text-amber-600" },
  "drive.folder.delete": { icon: Trash2, label: "폴더 삭제", color: "text-red-600" },
  "drive.folder.sync_all": { icon: FolderPlus, label: "폴더 일괄 동기화", color: "text-amber-600" },
  "drive.item.move": { icon: FileText, label: "자료 이동", color: "text-accent" },
  "drive.item.copy": { icon: FileText, label: "자료 복사", color: "text-accent" },
  "drive.batch_organize": { icon: Sparkles, label: "AI 정리 적용", color: "text-[#673ab7]" },
  "drive.batch_organize.undo": { icon: Sparkles, label: "AI 정리 되돌림", color: "text-amber-600" },
  "drive.backup.download": { icon: Download, label: "백업 다운로드", color: "text-emerald-600" },
  "drive.backup.import": { icon: Upload, label: "백업 복원", color: "text-emerald-600" },
  "drive.favorite.add": { icon: FileText, label: "즐겨찾기 추가", color: "text-amber-500" },
  "drive.favorite.remove": { icon: FileText, label: "즐겨찾기 해제", color: "text-text-tertiary" },
  "drive_soft_delete": { icon: Trash2, label: "휴지통으로 이동", color: "text-red-500" },
  "drive_restore": { icon: RotateCcw, label: "복구", color: "text-emerald-600" },
  "drive_permanent_delete": { icon: Trash2, label: "영구 삭제", color: "text-red-700" },
  "drive_empty_trash": { icon: Trash2, label: "휴지통 비움", color: "text-red-700" },
};

function fmtDate(s: string | null): string {
  if (!s) return "";
  return s.slice(0, 16).replace("T", " ");
}

export function DriveActivityModal({ onClose }: Props) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ items: ActivityItem[] }>("/api/drive/activity?limit=100");
        setItems(r.items);
      } catch (e: any) {
        setError(e?.detail || e?.message || "불러오기 실패");
        setItems([]);
      }
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h3 className="text-[15px] font-semibold text-text-primary inline-flex items-center gap-1.5">
            <Activity size={16} /> 드라이브 활동 기록
          </h3>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="px-5 py-3 text-[13px] text-red-700">{error}</div>
          )}
          {items === null ? (
            <div className="px-5 py-8 text-center text-[13px] text-text-tertiary">불러오는 중...</div>
          ) : items.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-text-tertiary">
              아직 활동 기록이 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-border-default/50">
              {items.map((it) => {
                const meta = ACTION_META[it.action] || {
                  icon: FileText, label: it.action, color: "text-text-tertiary",
                };
                const Icon = meta.icon;
                return (
                  <li key={it.id} className="px-5 py-2.5 flex items-start gap-3">
                    <Icon size={15} className={`mt-0.5 ${meta.color} flex-shrink-0`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[13px] text-text-primary font-medium">
                          {meta.label}
                        </span>
                        {it.target && (
                          <span className="text-[11.5px] text-text-tertiary font-mono">
                            {it.target}
                          </span>
                        )}
                      </div>
                      {it.detail && (
                        <div className="text-[11.5px] text-text-tertiary mt-0.5 truncate" title={it.detail}>
                          {it.detail}
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] text-text-tertiary flex-shrink-0">
                      {fmtDate(it.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border-default text-[11px] text-text-tertiary">
          최근 100건 표시. 자료 변경 / 폴더 / AI 정리 / 백업 / 즐겨찾기 등 모두 기록됩니다.
        </div>
      </div>
    </div>
  );
}
