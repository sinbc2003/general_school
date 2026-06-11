/**
 * DrivePage 공유 타입 + 상수 + helpers.
 *
 * DrivePage 컴포넌트가 너무 커서 분리. 다른 sub-component (DriveContextMenu,
 * BulkActionBar, DriveProposalModal 등)와 일관성 유지.
 */

import {
  FileText, FileSpreadsheet, Presentation, ClipboardList, FileType2,
  BookA, StickyNote,
  type LucideIcon,
} from "lucide-react";

export type ItemType =
  | "docs" | "sheets" | "decks" | "surveys" | "hwps"
  | "word_decks" | "boards";
export type SortKey = "name" | "owner" | "updated" | "size";
export type SortDir = "asc" | "desc";

export interface DriveItem {
  id: number;
  type: ItemType;
  title: string;
  course_id: number | null;
  owner_id: number | null;
  folder_id: number | null;
  updated_at: string | null;
  created_at: string | null;
  deleted_at: string | null;
  storage_bytes: number;
}

export interface DriveInfo {
  quota_bytes: number;
  used_bytes: number;
  available_bytes: number | null;
  usage_ratio: number;
  unlimited: boolean;
  expires_at: string | null;
  days_until_expire: number | null;
  user_type: string;
  lifecycle_status: string;
}

export const TYPE_META: Record<
  ItemType,
  { label: string; icon: LucideIcon; color: string; bg: string }
> = {
  docs: {
    label: "문서", icon: FileText, color: "#1d4ed8",
    bg: "linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)",
  },
  decks: {
    label: "프리젠테이션", icon: Presentation, color: "#a16207",
    bg: "linear-gradient(135deg, #fde4b8 0%, #fbbf24 100%)",
  },
  surveys: {
    label: "설문지", icon: ClipboardList, color: "#7e22ce",
    bg: "linear-gradient(135deg, #ede9fe 0%, #c4b5fd 100%)",
  },
  sheets: {
    label: "스프레드시트", icon: FileSpreadsheet, color: "#107c41",
    bg: "linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%)",
  },
  hwps: {
    label: "한컴 문서", icon: FileType2, color: "#0891b2",
    bg: "linear-gradient(135deg, #cffafe 0%, #67e8f9 100%)",
  },
  word_decks: {
    label: "단어장", icon: BookA, color: "#0284c7",
    bg: "linear-gradient(135deg, #e0f2fe 0%, #7dd3fc 100%)",
  },
  boards: {
    label: "보드", icon: StickyNote, color: "#b45309",
    bg: "linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%)",
  },
};

export const ITEM_TYPES: ItemType[] = [
  "docs", "sheets", "decks", "surveys", "hwps", "word_decks", "boards",
];

export function formatMB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function itemKey(it: { type: ItemType; id: number }): string {
  return `${it.type}:${it.id}`;
}

/** 자료 클릭 시 이동 URL — admin/student mode + 강좌 소속 여부 분기. */
export function hrefForItem(
  it: DriveItem,
  mode: "admin" | "student",
): string {
  const baseClassroom = mode === "admin" ? "/classroom" : "/s/classroom";
  const baseDocs = mode === "admin" ? "/docs" : "/s/docs";

  if (it.type === "sheets") {
    return mode === "admin" ? `/sheets/${it.id}` : `/s/sheets/${it.id}`;
  }
  if (it.type === "hwps") {
    return mode === "admin" ? `/hwps/${it.id}` : `/s/hwps/${it.id}`;
  }
  // 에듀테크 도구 — course_id 무관, 도구 페이지로
  if (it.type === "word_decks") {
    return mode === "admin" ? `/tools/wordbook/${it.id}` : `/s/wordbook/${it.id}`;
  }
  if (it.type === "boards") {
    return mode === "admin" ? `/tools/board/${it.id}` : `/s/board/${it.id}`;
  }
  const segMap: Record<ItemType, string> = {
    docs: "docs",
    decks: "decks",
    surveys: "surveys",
    sheets: "sheets",
    hwps: "hwps",
    word_decks: "word_decks",
    boards: "boards",
  };
  if (it.course_id) return `${baseClassroom}/${it.course_id}/${segMap[it.type]}/${it.id}`;
  if (it.type === "docs") return `${baseDocs}/${it.id}`;
  if (it.type === "decks") return `${baseDocs}/decks/${it.id}`;
  if (it.type === "surveys") return `${baseDocs}/forms/${it.id}`;
  return "#";
}

/**
 * Drive AI에 보낼 현재 드라이브 상태 (메타만 — 본문 X).
 * 자료는 type/id/제목/현재 folder_id. 폴더는 id/이름/parent/잠금 여부.
 * 토큰 절약 위해 간결한 line 포맷.
 */
export function buildDriveContext(
  items: DriveItem[],
  folders: { id: number; parent_id: number | null; name: string; is_system_locked: boolean }[],
): string {
  const folderLines = folders.map(
    (f) =>
      `F${f.id} parent=${f.parent_id ?? "root"} name="${f.name}"${f.is_system_locked ? " [LOCKED]" : ""}`,
  );
  const itemLines = items.map(
    (it) =>
      `${it.type}:${it.id} folder=${it.folder_id ?? "root"} title="${it.title}"`,
  );
  return [
    "# 현재 드라이브 상태",
    "",
    `## 폴더 (${folders.length})`,
    ...folderLines,
    "",
    `## 자료 (${items.length})`,
    ...itemLines,
    "",
    "위 자료를 분석해 drive_propose_organization 도구로 정리안을 한 번 호출하세요.",
    "삭제 금지. rename은 '01. 원본이름' 식 prefix. 새 카테고리 폴더는 create_folder.",
    "잠금 폴더(LOCKED)는 그 자체 수정/삭제 금지. 그 안에 자료 이동은 OK.",
  ].join("\n");
}
