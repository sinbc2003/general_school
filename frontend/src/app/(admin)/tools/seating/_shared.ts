/**
 * 자리배치 — 공유 타입·헬퍼 (편집기·인쇄·목록 공용).
 *
 * 좌표: row 0 = 교실 앞(칠판·교탁 쪽). 좌석 id = `${deskId}.0`(왼쪽/단일)·`.1`(오른쪽).
 */

export interface Desk {
  id: string;
  row: number;
  col: number;
  seats: 1 | 2;
}

export interface Door {
  id: string;
  wall: "front" | "back" | "left" | "right";
  pos: number; // 0~1 (벽 위 상대 위치)
}

export interface Layout {
  rows: number;
  cols: number;
  desks: Desk[];
  aisles: number[]; // 해당 col 다음(오른쪽)에 통로
  podium: { side: "front" | "back"; align: "left" | "center" | "right" } | null;
  board: "front";
  doors: Door[];
  facing: "front";
}

export interface RosterEntry {
  key: string;
  name: string;
  number?: number | null;
  student_number?: number | null;
  user_id?: number | null;
}

export interface Constraints {
  forbidden_pairs: [string, string][];
  keep_together: [string, string][];
  alone: string[];
  fixed: Record<string, string>; // key -> seatId
  excluded: string[];
}

export type Assignment = Record<string, string>; // seatId -> rosterKey

export interface Chart {
  id: number;
  title: string;
  description: string | null;
  layout: Layout;
  roster: RosterEntry[];
  constraints: Constraints;
  assignment: Assignment;
}

export const deskId = (row: number, col: number) => `r${row}c${col}`;
export const seatId = (did: string, idx: number) => `${did}.${idx}`;
export const deskOfSeat = (sid: string) => sid.split(".")[0];

export function seatsOf(desk: Desk): string[] {
  const n = desk.seats >= 2 ? 2 : 1;
  return Array.from({ length: n }, (_, i) => seatId(desk.id, i));
}

let _kc = 0;
export function genKey(): string {
  _kc += 1;
  return `m${Date.now().toString(36)}${_kc}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyConstraints(): Constraints {
  return { forbidden_pairs: [], keep_together: [], alone: [], fixed: {}, excluded: [] };
}

/** 기본 교실: 5줄 × 3열 2인 책상 (30석). */
export function defaultLayout(): Layout {
  const desks: Desk[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      desks.push({ id: deskId(r, c), row: r, col: c, seats: 2 });
    }
  }
  return {
    rows: 5,
    cols: 3,
    desks,
    aisles: [],
    podium: { side: "front", align: "left" },
    board: "front",
    doors: [{ id: "d1", wall: "front", pos: 0.92 }],
    facing: "front",
  };
}

/** API 응답(부분/빈 JSON 가능)을 완전한 Chart로 정규화. */
export function normalizeChart(raw: any): Chart {
  const layoutRaw = raw?.layout && Object.keys(raw.layout).length ? raw.layout : defaultLayout();
  const layout: Layout = {
    rows: layoutRaw.rows ?? 5,
    cols: layoutRaw.cols ?? 3,
    desks: (layoutRaw.desks ?? []).map((d: any) => ({
      id: String(d.id),
      row: Number(d.row),
      col: Number(d.col),
      seats: Number(d.seats) >= 2 ? 2 : 1,
    })),
    aisles: (layoutRaw.aisles ?? []).map((x: any) => Number(x)),
    podium: layoutRaw.podium ?? { side: "front", align: "left" },
    board: "front",
    doors: (layoutRaw.doors ?? []).map((d: any, i: number) => ({
      id: String(d.id ?? `d${i}`),
      wall: d.wall ?? "front",
      pos: typeof d.pos === "number" ? d.pos : 0.9,
    })),
    facing: "front",
  };
  if (!layout.desks.length) {
    const dl = defaultLayout();
    layout.desks = dl.desks;
    layout.rows = dl.rows;
    layout.cols = dl.cols;
  }
  const cRaw = raw?.constraints ?? {};
  const constraints: Constraints = {
    forbidden_pairs: cRaw.forbidden_pairs ?? [],
    keep_together: cRaw.keep_together ?? [],
    alone: cRaw.alone ?? [],
    fixed: cRaw.fixed ?? {},
    excluded: cRaw.excluded ?? [],
  };
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? null,
    layout,
    roster: (raw?.roster ?? []).map((r: any) => ({
      key: String(r.key),
      name: String(r.name ?? ""),
      number: r.number ?? null,
      student_number: r.student_number ?? null,
      user_id: r.user_id ?? null,
    })),
    constraints,
    assignment: raw?.assignment ?? {},
  };
}

/** 학생 표시 라벨 — 번호 있으면 "12 홍길동", 없으면 이름만. */
export function studentLabel(e: RosterEntry): string {
  return e.number != null ? `${e.number} ${e.name}` : e.name;
}

/** 강좌/담임 명단(API 학생 객체) → RosterEntry. user_id 기준 키로 재import 안정. */
export function studentsToRoster(
  students: Array<{ user_id?: number; student_id?: number; id?: number; name: string; student_number?: number | null; number?: number | null }>,
): RosterEntry[] {
  return students
    .filter((s) => s.name)
    .map((s) => {
      const uid = s.user_id ?? s.student_id ?? s.id ?? null;
      const snum = s.student_number ?? null;
      const number = s.number ?? (typeof snum === "number" ? snum % 100 : null);
      return {
        key: uid != null ? `u${uid}` : genKey(),
        name: s.name,
        number,
        student_number: snum,
        user_id: uid,
      };
    });
}

/** 책상 그리드를 통로(aisle) 기준 시각적 열 그룹으로 — 렌더 공용. */
export function colGroups(layout: Layout): number[][] {
  const aisles = new Set(layout.aisles);
  const groups: number[][] = [];
  let cur: number[] = [];
  for (let c = 0; c < layout.cols; c++) {
    cur.push(c);
    if (aisles.has(c)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export const deskMap = (layout: Layout): Map<string, Desk> => {
  const m = new Map<string, Desk>();
  for (const d of layout.desks) m.set(deskId(d.row, d.col), d);
  return m;
};
