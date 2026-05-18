"use client";

/**
 * 전체 timeline 탭 — 자유 산출물 + 과제 제출 + 동아리 산출 통합 시간순 목록.
 */

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, LayoutGrid, ListChecks, Users2 } from "lucide-react";
import { api } from "@/lib/api/client";
import type { TimelineItem } from "../_shared";
import { EmptyState, StatCard } from "../_shared";


export function TimelineTab() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/all-activities");
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = {
    artifact: items.filter((i) => i.type === "artifact").length,
    assignment: items.filter((i) => i.type === "assignment_submission").length,
    club: items.filter((i) => i.type === "club_submission").length,
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="총 활동" value={items.length} icon={ListChecks} accent />
        <StatCard label="자유 산출물" value={totals.artifact} icon={LayoutGrid} />
        <StatCard label="과제 제출물" value={totals.assignment} icon={ClipboardList} />
        <StatCard label="동아리 산출물" value={totals.club} icon={Users2} />
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <EmptyState text="아직 활동 기록이 없습니다" />
      ) : (
        <div className="space-y-2">
          {items.map((it) => <TimelineRow key={`${it.type}-${it.id}`} item={it} />)}
        </div>
      )}
    </div>
  );
}


function TimelineRow({ item }: { item: TimelineItem }) {
  const typeMeta = {
    artifact: { label: "자유 산출물", color: "bg-cream-200 text-blue-700", icon: LayoutGrid },
    assignment_submission: { label: "과제 제출", color: "bg-purple-100 text-purple-700", icon: ClipboardList },
    club_submission: { label: "동아리 산출", color: "bg-orange-100 text-orange-700", icon: Users2 },
  }[item.type];
  const Icon = typeMeta.icon;

  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-3 flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={16} className="text-text-tertiary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`px-2 py-0.5 text-caption rounded ${typeMeta.color}`}>{typeMeta.label}</span>
          {item.type === "assignment_submission" && item.show_in_portfolio && (
            <span className="px-2 py-0.5 text-caption rounded bg-green-100 text-green-700">포트폴리오 노출 ON</span>
          )}
          {item.type === "artifact" && item.is_public && (
            <span className="px-2 py-0.5 text-caption rounded bg-green-100 text-green-700">공개</span>
          )}
          {item.date && <span className="text-caption text-text-tertiary">{item.date.slice(0, 10)}</span>}
        </div>
        <div className="text-body text-text-primary font-medium truncate">{item.title}</div>
        {item.type === "artifact" && item.description && (
          <div className="text-caption text-text-secondary line-clamp-2 mt-0.5">{item.description}</div>
        )}
        {item.type === "assignment_submission" && (
          <div className="text-caption text-text-tertiary mt-0.5">
            {item.subject} {item.filename && `· ${item.filename}`} {item.status && `· ${item.status}`}
          </div>
        )}
        {item.type === "club_submission" && (
          <div className="text-caption text-text-tertiary mt-0.5">
            {item.club_name} · {item.submission_type}
          </div>
        )}
      </div>
    </div>
  );
}
