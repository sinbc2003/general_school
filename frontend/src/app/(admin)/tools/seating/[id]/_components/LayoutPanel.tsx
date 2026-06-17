"use client";

/** 교실 배치 패널 — 책상 그리드(WYSIWYG) + 통로·교탁·문 설정. */

import { Minus, Plus, DoorOpen } from "lucide-react";
import RoomChart from "./RoomChart";
import { Desk, Door, Layout, deskId } from "../../_shared";

interface Props {
  layout: Layout;
  onChange: (layout: Layout) => void;
}

const WALL_LABEL: Record<Door["wall"], string> = {
  front: "앞", back: "뒤", left: "왼쪽", right: "오른쪽",
};

export default function LayoutPanel({ layout, onChange }: Props) {
  const set = (patch: Partial<Layout>) => onChange({ ...layout, ...patch });

  const clampDesks = (desks: Desk[], rows: number, cols: number) =>
    desks.filter((d) => d.row < rows && d.col < cols);

  const setRows = (rows: number) => {
    rows = Math.max(1, Math.min(20, rows));
    set({ rows, desks: clampDesks(layout.desks, rows, layout.cols) });
  };
  const setCols = (cols: number) => {
    cols = Math.max(1, Math.min(20, cols));
    set({
      cols,
      desks: clampDesks(layout.desks, layout.rows, cols),
      aisles: layout.aisles.filter((c) => c < cols - 1),
    });
  };

  const toggleDesk = (row: number, col: number) => {
    const id = deskId(row, col);
    const existing = layout.desks.find((d) => d.id === id);
    let desks: Desk[];
    if (!existing) {
      desks = [...layout.desks, { id, row, col, seats: 2 }];
    } else if (existing.seats === 2) {
      desks = layout.desks.map((d) => (d.id === id ? { ...d, seats: 1 } : d));
    } else {
      desks = layout.desks.filter((d) => d.id !== id);
    }
    set({ desks });
  };

  const fillAll = (seats: 1 | 2 | 0) => {
    if (seats === 0) { set({ desks: [] }); return; }
    const desks: Desk[] = [];
    for (let r = 0; r < layout.rows; r++)
      for (let c = 0; c < layout.cols; c++)
        desks.push({ id: deskId(r, c), row: r, col: c, seats });
    set({ desks });
  };

  const toggleAisle = (col: number) => {
    const has = layout.aisles.includes(col);
    set({ aisles: has ? layout.aisles.filter((c) => c !== col) : [...layout.aisles, col].sort((a, b) => a - b) });
  };

  const setPodium = (align: "left" | "center" | "right" | "none") => {
    set({ podium: align === "none" ? null : { side: "front", align } });
  };

  const addDoor = () => {
    if (layout.doors.length >= 8) return;
    const id = `door${Date.now().toString(36)}`;
    set({ doors: [...layout.doors, { id, wall: "front", pos: 0.9 }] });
  };
  const updateDoor = (id: string, patch: Partial<Door>) =>
    set({ doors: layout.doors.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const removeDoor = (id: string) => set({ doors: layout.doors.filter((d) => d.id !== id) });

  const stepper = (label: string, value: number, on: (v: number) => void) => (
    <div className="flex items-center gap-2">
      <span className="text-caption text-text-secondary w-8">{label}</span>
      <button onClick={() => on(value - 1)} className="w-7 h-7 rounded border border-border-default hover:bg-bg-secondary flex items-center justify-center"><Minus size={13} /></button>
      <span className="w-7 text-center text-body font-medium">{value}</span>
      <button onClick={() => on(value + 1)} className="w-7 h-7 rounded border border-border-default hover:bg-bg-secondary flex items-center justify-center"><Plus size={13} /></button>
    </div>
  );

  const podiumAlign = layout.podium?.align ?? "none";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      {/* 컨트롤 */}
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="text-body font-medium">크기</div>
          {stepper("줄", layout.rows, setRows)}
          {stepper("열", layout.cols, setCols)}
        </div>

        <div className="space-y-2">
          <div className="text-body font-medium">빠른 채우기</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => fillAll(2)} className="px-3 py-1.5 rounded-lg border border-border-default text-caption hover:bg-bg-secondary">전체 2인</button>
            <button onClick={() => fillAll(1)} className="px-3 py-1.5 rounded-lg border border-border-default text-caption hover:bg-bg-secondary">전체 1인</button>
            <button onClick={() => fillAll(0)} className="px-3 py-1.5 rounded-lg border border-border-default text-caption hover:bg-bg-secondary">전체 비우기</button>
          </div>
          <div className="text-[11px] text-text-tertiary">오른쪽 그리드에서 책상을 클릭하면 <b>2인 → 1인 → 없음</b>으로 바뀝니다.</div>
        </div>

        {layout.cols > 1 && (
          <div className="space-y-2">
            <div className="text-body font-medium">통로 (열 사이)</div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: layout.cols - 1 }, (_, c) => (
                <button
                  key={c}
                  onClick={() => toggleAisle(c)}
                  className={`px-2 py-1 rounded text-caption border ${
                    layout.aisles.includes(c) ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-border-default hover:bg-bg-secondary"
                  }`}
                >
                  {c + 1}–{c + 2}열
                </button>
              ))}
            </div>
            <div className="text-[11px] text-text-tertiary">통로를 두면 그 사이는 ‘인접’으로 안 칩니다.</div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-body font-medium">교탁 위치 (칠판 쪽)</div>
          <div className="flex flex-wrap gap-1.5">
            {([["none", "없음"], ["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setPodium(v)}
                className={`px-3 py-1.5 rounded-lg text-caption border ${
                  podiumAlign === v ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-border-default hover:bg-bg-secondary"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-body font-medium">출입문</div>
            <button onClick={addDoor} className="inline-flex items-center gap-1 px-2 py-1 rounded text-caption text-emerald-700 hover:bg-emerald-50">
              <DoorOpen size={13} /> 추가
            </button>
          </div>
          {layout.doors.length === 0 && <div className="text-[11px] text-text-tertiary">문 위치를 추가하면 자리표에 표시됩니다.</div>}
          <div className="space-y-2">
            {layout.doors.map((d) => (
              <div key={d.id} className="flex items-center gap-2">
                <select
                  value={d.wall}
                  onChange={(e) => updateDoor(d.id, { wall: e.target.value as Door["wall"] })}
                  className="px-2 py-1 border border-border-default rounded text-caption bg-bg-primary"
                >
                  {(["front", "back", "left", "right"] as const).map((w) => (
                    <option key={w} value={w}>{WALL_LABEL[w]}</option>
                  ))}
                </select>
                <input
                  type="range" min={0} max={100} value={Math.round(d.pos * 100)}
                  onChange={(e) => updateDoor(d.id, { pos: parseInt(e.target.value, 10) / 100 })}
                  className="flex-1"
                />
                <button onClick={() => removeDoor(d.id)} className="text-text-tertiary hover:text-rose-600 text-caption px-1">✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 미리보기 (편집) */}
      <div className="overflow-auto">
        <RoomChart layout={layout} mode="layout" onToggleDesk={toggleDesk} />
      </div>
    </div>
  );
}
