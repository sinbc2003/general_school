"use client";

/**
 * Drive AI 정리안 미리보기 + 동의 모달.
 *
 * AI가 drive_propose_organization 도구로 정리안(actions) 제안 →
 * 이 모달에 표시 → 사용자 "동의" 클릭 시 batch endpoint로 일괄 적용.
 *
 * 액션 종류:
 *  - create_folder: 새 폴더 생성 (이름 + temp_id)
 *  - rename: 자료 제목 변경 ('01. 원본이름' 식)
 *  - move: 자료 폴더 이동
 *  - rename_and_move: 둘 다 한 번에
 *
 * 삭제 액션 없음 — 보수적.
 */

import { useState } from "react";
import { X, FolderPlus, Pencil, ArrowRight, AlertCircle, CheckCircle2, Undo2 } from "lucide-react";
import { api } from "@/lib/api/client";

export interface ProposalAction {
  action: "create_folder" | "rename" | "move" | "rename_and_move";
  // create_folder
  folder_name?: string;
  parent_folder_id?: number | null;
  parent_temp_id?: string;
  temp_id?: string;
  // rename / move
  item_type?: "docs" | "sheets" | "decks" | "surveys" | "hwps";
  item_id?: number;
  new_title?: string;
  target_folder_id?: number | null;
  target_temp_id?: string;
  reason?: string;
}

interface Props {
  summary: string;
  actions: ProposalAction[];
  itemsLookup: Record<string, string>; // "{type}:{id}" → 현재 title (display용)
  foldersLookup: Record<number, string>; // folder_id → 폴더명
  onClose: () => void;
  onApplied: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  docs: "문서", sheets: "시트", decks: "덱", surveys: "설문", hwps: "한컴",
};

export function DriveProposalModal({
  summary, actions, itemsLookup, foldersLookup, onClose, onApplied,
}: Props) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; renamed: number; moved: number } | null>(null);
  const [undoLog, setUndoLog] = useState<any[] | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState<{ renamed: number; moved: number; folders_deleted: number } | null>(null);

  // temp_id → folder_name 매핑 (preview용)
  const tempNames: Record<string, string> = {};
  actions.forEach((a) => {
    if (a.action === "create_folder" && a.temp_id && a.folder_name) {
      tempNames[a.temp_id] = a.folder_name;
    }
  });

  const folderLabel = (fid: number | null | undefined, tid: string | undefined): string => {
    if (tid) return `🆕 ${tempNames[tid] || tid}`;
    if (fid === null || fid === undefined) return "(루트)";
    return foldersLookup[fid] || `폴더 #${fid}`;
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const r = await api.post<{
        created_folders: number;
        renamed: number;
        moved: number;
        undo_log?: any[];
      }>(
        "/api/drive/items/_batch-organize",
        { actions },
      );
      setDone({ created: r.created_folders, renamed: r.renamed, moved: r.moved });
      setUndoLog(r.undo_log || null);
      onApplied();
    } catch (e: any) {
      setError(e?.detail || e?.message || "적용 실패");
    } finally {
      setApplying(false);
    }
  };

  const undo = async () => {
    if (!undoLog || undoLog.length === 0) return;
    if (!confirm("AI 정리를 모두 되돌립니까?\n자료의 이름과 폴더 위치가 원래대로 돌아갑니다.")) return;
    setUndoing(true);
    setError(null);
    try {
      const r = await api.post<{
        renamed: number; moved: number; folders_deleted: number; errors: string[];
      }>("/api/drive/items/_undo-organize", { undo_log: undoLog });
      setUndone({ renamed: r.renamed, moved: r.moved, folders_deleted: r.folders_deleted });
      setUndoLog(null);
      onApplied(); // list 새로고침
    } catch (e: any) {
      setError(e?.detail || e?.message || "되돌리기 실패");
    } finally {
      setUndoing(false);
    }
  };

  const createActions = actions.filter((a) => a.action === "create_folder");
  const itemActions = actions.filter((a) => a.action !== "create_folder");

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h3 className="text-[15px] font-semibold text-text-primary">AI 정리안 미리보기</h3>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 bg-cream-100 border-b border-cream-200 text-[13px] text-text-secondary">
          {summary}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {createActions.length > 0 && (
            <div>
              <div className="text-[12px] font-medium text-text-tertiary mb-2 flex items-center gap-1">
                <FolderPlus size={12} /> 새 폴더 ({createActions.length})
              </div>
              <ul className="space-y-1">
                {createActions.map((a, i) => (
                  <li key={i} className="text-[13px] px-3 py-1.5 bg-amber-50 border border-amber-200 rounded">
                    <strong>{a.folder_name}</strong>
                    {a.parent_temp_id && <span className="text-[11px] text-text-tertiary ml-2">↳ {tempNames[a.parent_temp_id] || a.parent_temp_id} 안</span>}
                    {a.parent_folder_id != null && <span className="text-[11px] text-text-tertiary ml-2">↳ {foldersLookup[a.parent_folder_id] || `#${a.parent_folder_id}`} 안</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {itemActions.length > 0 && (
            <div>
              <div className="text-[12px] font-medium text-text-tertiary mb-2 flex items-center gap-1">
                <Pencil size={12} /> 자료 정리 ({itemActions.length})
              </div>
              <ul className="space-y-1.5">
                {itemActions.map((a, i) => {
                  const key = `${a.item_type}:${a.item_id}`;
                  const currentTitle = itemsLookup[key] || `${TYPE_LABEL[a.item_type || ""] || "?"} #${a.item_id}`;
                  const isRename = a.action === "rename" || a.action === "rename_and_move";
                  const isMove = a.action === "move" || a.action === "rename_and_move";
                  return (
                    <li
                      key={i}
                      className="text-[12.5px] px-3 py-2 border border-border-default rounded bg-bg-primary"
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="text-[10px] text-text-tertiary mt-0.5 px-1.5 py-0.5 bg-bg-secondary rounded">
                          {TYPE_LABEL[a.item_type || ""] || "?"}
                        </span>
                        <div className="min-w-0 flex-1">
                          {isRename ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-text-tertiary line-through">{currentTitle}</span>
                              <ArrowRight size={11} className="text-accent flex-shrink-0" />
                              <strong className="text-text-primary">{a.new_title}</strong>
                            </div>
                          ) : (
                            <div className="text-text-primary">{currentTitle}</div>
                          )}
                          {isMove && (
                            <div className="text-[11px] text-text-tertiary mt-0.5">
                              → {folderLabel(a.target_folder_id, a.target_temp_id)}
                            </div>
                          )}
                          {a.reason && (
                            <div className="text-[11px] text-text-tertiary mt-0.5 italic">{a.reason}</div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {actions.length === 0 && (
            <div className="text-[13px] text-text-tertiary py-6 text-center">
              AI가 제안한 정리안이 없습니다.
            </div>
          )}
        </div>

        {error && (
          <div className="px-5 py-2 flex items-center gap-2 bg-red-50 border-t border-red-200 text-[13px] text-red-900">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        {done && !undone && (
          <div className="px-5 py-2 flex items-center gap-2 bg-emerald-50 border-t border-emerald-200 text-[13px] text-emerald-900">
            <CheckCircle2 size={14} />
            완료 — 새 폴더 {done.created}개, 이름변경 {done.renamed}개, 이동 {done.moved}개
          </div>
        )}
        {undone && (
          <div className="px-5 py-2 flex items-center gap-2 bg-amber-50 border-t border-amber-200 text-[13px] text-amber-900">
            <Undo2 size={14} />
            되돌림 — 이름 {undone.renamed}개 복원, 이동 {undone.moved}개 복원, 빈 폴더 {undone.folders_deleted}개 삭제
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-text-secondary hover:bg-bg-secondary rounded"
          >
            {done ? "닫기" : "취소"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={apply}
              disabled={applying || actions.length === 0}
              className="px-4 py-1.5 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-50"
            >
              {applying ? "적용 중..." : `동의 — ${actions.length}개 적용`}
            </button>
          )}
          {done && undoLog && undoLog.length > 0 && !undone && (
            <button
              type="button"
              onClick={undo}
              disabled={undoing}
              className="px-4 py-1.5 text-[13px] bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              title="방금 적용한 AI 정리를 모두 되돌립니다"
            >
              <Undo2 size={13} /> {undoing ? "되돌리는 중..." : "되돌리기"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
