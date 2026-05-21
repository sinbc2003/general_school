/**
 * DrivePage 공유 타입 + 상수 + helpers.
 *
 * DrivePage 컴포넌트가 너무 커서 분리. 다른 sub-component (DriveContextMenu,
 * BulkActionBar, DriveProposalModal 등)와 일관성 유지.
 */

import {
  FileText, FileSpreadsheet, Presentation, ClipboardList, FileType2,
  type LucideIcon,
} from "lucide-react";

export type ItemType = "docs" | "sheets" | "decks" | "surveys" | "hwps";
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
};

export const ITEM_TYPES: ItemType[] = ["docs", "sheets", "decks", "surveys", "hwps"];

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
  const segMap: Record<ItemType, string> = {
    docs: "docs",
    decks: "decks",
    surveys: "surveys",
    sheets: "sheets",
    hwps: "hwps",
  };
  if (it.course_id) return `${baseClassroom}/${it.course_id}/${segMap[it.type]}/${it.id}`;
  if (it.type === "docs") return `${baseDocs}/${it.id}`;
  if (it.type === "decks") return `${baseDocs}/decks/${it.id}`;
  if (it.type === "surveys") return `${baseDocs}/forms/${it.id}`;
  return "#";
}
