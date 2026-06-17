"use client";

/**
 * 교실 자리표 렌더러 — 편집기·인쇄 공용.
 *
 * mode:
 *  - "layout"  : 책상 구조 편집 (빈칸 클릭 = 책상 추가, 책상 클릭 = 1인↔2인↔없음)
 *  - "seating" : 학생 배치 (좌석 클릭 = 선택/스왑, 핀 = 자리 고정)
 *  - "print"   : 정적 (교탁 게시용)
 *
 * 좌표: row 0 = 교실 앞. flipV=true면 앞(칠판·교탁)을 아래로(교탁에서 본 방향),
 * flipH=true면 좌우 반전.
 */

import { Pin, Plus } from "lucide-react";
import {
  Assignment, Constraints, Desk, Layout, RosterEntry,
  colGroups, deskId, deskMap, seatId, seatsOf, studentLabel,
} from "../../_shared";

interface Props {
  layout: Layout;
  roster?: RosterEntry[];
  assignment?: Assignment;
  constraints?: Constraints;
  mode: "layout" | "seating" | "print";
  selectedSeat?: string | null;
  onToggleDesk?: (row: number, col: number) => void;
  onSeatClick?: (sid: string) => void;
  onPinToggle?: (sid: string) => void;
  flipH?: boolean;
  flipV?: boolean;
}

export default function RoomChart({
  layout, roster = [], assignment = {}, constraints,
  mode, selectedSeat, onToggleDesk, onSeatClick, onPinToggle, flipH, flipV,
}: Props) {
  const dmap = deskMap(layout);
  const rosterByKey = new Map(roster.map((r) => [r.key, r]));
  const fixedSeats = new Set(Object.values(constraints?.fixed ?? {}));

  const rowsOrder = Array.from({ length: layout.rows }, (_, i) => i);
  const orderedRows = flipV ? [...rowsOrder].reverse() : rowsOrder;
  let groups = colGroups(layout);
  if (flipH) groups = [...groups].reverse().map((g) => [...g].reverse());

  const labelColor = "text-text-tertiary";

  /* ── 칠판 + 교탁 영역 (교실 앞) ───────────────────────────────────── */
  const podiumAlign = (() => {
    let a = layout.podium?.align ?? "left";
    if (flipH) a = a === "left" ? "right" : a === "right" ? "left" : "center";
    return a;
  })();

  const FrontZone = (
    <div className={`flex ${flipV ? "flex-col-reverse" : "flex-col"} gap-1.5`}>
      <div className="h-7 rounded-md bg-emerald-900 text-emerald-50 text-xs font-semibold flex items-center justify-center tracking-widest shadow-inner">
        칠 판
      </div>
      {layout.podium && (
        <div
          className={`flex ${
            podiumAlign === "center" ? "justify-center" : podiumAlign === "right" ? "justify-end" : "justify-start"
          }`}
        >
          <div className="px-3 py-1 rounded border border-amber-300 bg-amber-50 text-[11px] text-amber-800 font-medium">
            교탁
          </div>
        </div>
      )}
    </div>
  );

  /* ── 책상 셀 ────────────────────────────────────────────────────── */
  function renderCell(row: number, col: number) {
    const did = deskId(row, col);
    const desk = dmap.get(did);

    if (mode === "layout") {
      if (!desk) {
        return (
          <button
            key={did}
            onClick={() => onToggleDesk?.(row, col)}
            className="w-[120px] h-[52px] rounded-lg border-2 border-dashed border-border-default/60 text-text-tertiary/40 hover:border-emerald-400 hover:text-emerald-500 flex items-center justify-center transition"
            title="책상 추가"
          >
            <Plus size={16} />
          </button>
        );
      }
      return (
        <button
          key={did}
          onClick={() => onToggleDesk?.(row, col)}
          className="w-[120px] h-[52px] rounded-lg border-2 border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100 flex items-center justify-center gap-1 transition"
          title="클릭: 1인 ↔ 2인 ↔ 없음"
        >
          {seatsOf(desk).map((sid) => (
            <span key={sid} className="w-[48px] h-[32px] rounded bg-white border border-emerald-200" />
          ))}
        </button>
      );
    }

    // seating / print
    if (!desk) {
      return <div key={did} className="w-[120px] h-[52px]" />;
    }
    return (
      <div key={did} className="flex gap-0.5 p-0.5 rounded-lg bg-slate-100 border border-slate-200 shadow-sm">
        {seatsOf(desk).map((sid) => renderSeat(sid))}
      </div>
    );
  }

  function renderSeat(sid: string) {
    const key = assignment[sid];
    const student = key ? rosterByKey.get(key) : undefined;
    const isSel = selectedSeat === sid;
    const isFixed = fixedSeats.has(sid);
    const interactive = mode === "seating";
    const w = "w-[58px] h-[44px]";

    const inner = (
      <>
        {student ? (
          <span className="text-[11px] leading-tight font-medium text-text-primary text-center px-0.5 break-keep line-clamp-2">
            {studentLabel(student)}
          </span>
        ) : (
          <span className="text-[10px] text-text-tertiary/50">{mode === "print" ? "" : "빈자리"}</span>
        )}
        {isFixed && (
          <Pin size={9} className="absolute top-0.5 right-0.5 text-rose-500 fill-rose-200" />
        )}
      </>
    );

    if (!interactive) {
      return (
        <div
          key={sid}
          className={`${w} relative rounded bg-white border flex items-center justify-center ${
            student ? "border-slate-300" : "border-dashed border-slate-200"
          }`}
        >
          {inner}
        </div>
      );
    }

    return (
      <div key={sid} className="relative">
        <button
          onClick={() => onSeatClick?.(sid)}
          className={`${w} relative rounded flex items-center justify-center transition border ${
            isSel
              ? "ring-2 ring-emerald-500 border-emerald-400 bg-emerald-50"
              : student
                ? "bg-white border-slate-300 hover:border-emerald-400"
                : "bg-white border-dashed border-slate-300 hover:border-emerald-400"
          }`}
        >
          {inner}
        </button>
        {student && (
          <button
            onClick={(e) => { e.stopPropagation(); onPinToggle?.(sid); }}
            className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full border flex items-center justify-center bg-white shadow-sm ${
              isFixed ? "text-rose-500 border-rose-300" : "text-text-tertiary/40 border-border-default hover:text-emerald-600"
            }`}
            title={isFixed ? "자리 고정 해제" : "이 자리 고정"}
          >
            <Pin size={8} className={isFixed ? "fill-rose-200" : ""} />
          </button>
        )}
      </div>
    );
  }

  /* ── 문 마커 (벽 위 절대 배치) ──────────────────────────────────── */
  function doorMarkers() {
    return (layout.doors ?? []).map((d) => {
      let wall = d.wall;
      let pos = d.pos;
      if (flipV && (wall === "front" || wall === "back")) wall = wall === "front" ? "back" : "front";
      if (flipH && (wall === "left" || wall === "right")) wall = wall === "left" ? "right" : "left";
      if (flipV && (d.wall === "left" || d.wall === "right")) pos = 1 - pos;
      if (flipH && (d.wall === "front" || d.wall === "back")) pos = 1 - pos;

      // 교실 앞=칠판 쪽. flipV면 화면상 앞이 아래.
      const style: React.CSSProperties = {};
      const horiz = wall === "front" || wall === "back";
      const atBottom = wall === "front" ? !!flipV : wall === "back" ? !flipV : false;
      const atRight = wall === "left" ? !!flipH : wall === "right" ? !flipH : false;
      if (horiz) {
        style.left = `calc(${pos * 100}% - 16px)`;
        if (atBottom) style.bottom = -7; else style.top = -7;
      } else {
        style.top = `calc(${pos * 100}% - 12px)`;
        if (atRight) style.right = -7; else style.left = -7;
      }
      return (
        <div
          key={d.id}
          className="absolute z-10 px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-[9px] text-amber-700 font-medium whitespace-nowrap"
          style={style}
        >
          문
        </div>
      );
    });
  }

  return (
    <div className="inline-block">
      <div className="relative border-2 border-slate-300 rounded-xl bg-white p-3 pb-3">
        {doorMarkers()}
        <div className={`flex ${flipV ? "flex-col-reverse" : "flex-col"} gap-3`}>
          {FrontZone}
          <div className="flex flex-col gap-2">
            {orderedRows.map((row) => (
              <div key={row} className="flex gap-4 justify-center">
                {groups.map((group, gi) => (
                  <div key={gi} className="flex gap-2">
                    {group.map((col) => renderCell(row, col))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {mode !== "print" && (
        <div className={`text-center text-[11px] ${labelColor} mt-1.5`}>
          {flipV ? "↑ 교실 뒤" : "↑ 교실 앞 (칠판·교탁)"}
        </div>
      )}
    </div>
  );
}
