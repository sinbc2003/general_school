"use client";

/**
 * 드라이브 자료 선택 모달.
 * 클래스룸 글 작성·과제 첨부에서 "내 드라이브에서 선택"으로 사용.
 *
 * 본인 자료(휴지통 제외)를 그리드로 보여주고 다중 선택 가능.
 * 선택 완료 시 onSelect([{type, source_id, title}])로 콜백.
 */

import { useCallback, useEffect, useState } from "react";
import {
  X, Search, FileText, FileSpreadsheet, Presentation, ClipboardList, CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api/client";

type ItemType = "docs" | "sheets" | "decks" | "surveys";

interface DriveItem {
  id: number;
  type: ItemType;
  title: string;
  course_id: number | null;
  updated_at: string | null;
}

export interface PickedAttachment {
  type: "doc" | "sheet" | "deck" | "survey";
  source_id: number;
  title: string;
}

const TYPE_META: Record<ItemType, { label: string; icon: any; color: string; attachType: PickedAttachment["type"] }> = {
  docs: { label: "문서", icon: FileText, color: "#1d4ed8", attachType: "doc" },
  sheets: { label: "시트", icon: FileSpreadsheet, color: "#107c41", attachType: "sheet" },
  decks: { label: "프리젠테이션", icon: Presentation, color: "#a16207", attachType: "deck" },
  surveys: { label: "설문지", icon: ClipboardList, color: "#7e22ce", attachType: "survey" },
};

export function DrivePicker({
  onClose,
  onSelect,
  allowedTypes,
}: {
  onClose: () => void;
  onSelect: (items: PickedAttachment[]) => void;
  /** 특정 타입만 표시. 미지정이면 4종 모두. */
  allowedTypes?: ItemType[];
}) {
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: DriveItem[] }>(`/api/drive/items?type=all`);
      const types = allowedTypes ?? ["docs", "sheets", "decks", "surveys"];
      setItems(r.items.filter((it) => types.includes(it.type)));
    } catch (e: any) {
      alert(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [allowedTypes]);

  useEffect(() => { load(); }, [load]);

  const togglePick = (key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirm = () => {
    const out: PickedAttachment[] = [];
    Array.from(picked).forEach((key) => {
      const [type, idStr] = key.split(":");
      const item = items.find((it) => it.type === type && String(it.id) === idStr);
      if (!item) return;
      const m = TYPE_META[item.type];
      out.push({ type: m.attachType, source_id: item.id, title: item.title });
    });
    onSelect(out);
    onClose();
  };

  const filtered = items.filter((it) => {
    if (typeFilter !== "all" && it.type !== typeFilter) return false;
    if (search.trim() && !it.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <h2 className="text-body font-semibold">내 드라이브에서 선택</h2>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        {/* 검색 + 필터 */}
        <div className="px-5 py-3 border-b border-border-default flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="제목 검색..."
              className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border-default rounded bg-bg-primary"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="px-2 py-1.5 text-[12px] border border-border-default rounded bg-bg-primary"
          >
            <option value="all">전체</option>
            {(allowedTypes ?? Object.keys(TYPE_META)).map((t) => (
              <option key={t} value={t}>{TYPE_META[t as ItemType].label}</option>
            ))}
          </select>
          <span className="text-[11px] text-text-tertiary ml-auto">선택 {picked.size}</span>
        </div>

        {/* 그리드 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-text-tertiary text-[13px] py-12">불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-text-tertiary text-[13px] py-12">
              자료가 없습니다. /drive에서 먼저 만들어주세요.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map((it) => {
                const m = TYPE_META[it.type];
                const Icon = m.icon;
                const key = `${it.type}:${it.id}`;
                const isPicked = picked.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePick(key)}
                    className={`text-left bg-bg-primary border-2 rounded-lg overflow-hidden hover:shadow-md transition ${
                      isPicked ? "border-accent" : "border-border-default"
                    }`}
                  >
                    <div
                      className="px-3 py-5 flex items-center justify-center relative"
                      style={{ backgroundColor: m.color + "15", minHeight: "80px" }}
                    >
                      <Icon size={28} style={{ color: m.color }} />
                      {isPicked && (
                        <CheckCircle2
                          size={18}
                          className="absolute top-2 right-2 text-accent fill-white"
                        />
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <div className="text-[12px] font-medium text-text-primary truncate">
                        {it.title}
                      </div>
                      <div className="text-[10px] text-text-tertiary mt-0.5">
                        {m.label}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-border-default flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] border border-border-default rounded"
          >
            취소
          </button>
          <button
            onClick={confirm}
            disabled={picked.size === 0}
            className="px-4 py-1.5 text-[12px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
          >
            {picked.size}개 첨부
          </button>
        </div>
      </div>
    </div>
  );
}
