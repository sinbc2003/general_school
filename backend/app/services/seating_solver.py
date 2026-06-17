"""자리배치 배정 알고리즘 — 제약 충족 랜덤 재시작 그리디.

순수 함수 (DB 비의존) — pytest로 직접 검증한다.

좌석 모델
  desks = [{"id": str, "row": int, "col": int, "seats": 1|2}]
  좌석 id : f"{deskId}.0" (왼쪽/단일), f"{deskId}.1" (오른쪽)
  aisles  : [col, ...] — 해당 col 다음(오른쪽)에 통로 → 가로 인접 끊김

인접(adjacent)
  같은 책상의 두 좌석, 또는 이웃 책상(맨해튼 거리 1). 가로 이웃은 사이에 통로가
  없을 때만. 세로 이웃(앞/뒤)은 항상.

제약
  excluded        : 배치 제외 (명단엔 있지만 자리 안 줌)
  fixed           : {key: seatId} — 고정 자리 (그대로 둠)
  keep_together   : [[a, b]] — 같은 2인 책상에 나란히
  alone           : [key] — 책상 독점 (2인 책상이면 옆자리 빈칸)
  forbidden_pairs : [[a, b]] — 인접 금지 (위 인접 정의 기준)

반환
  {"assignment": {seatId: key}, "warnings": [str], "satisfied": bool,
   "unplaced": [key]}
  - satisfied: 모든 제약 충족 + 미배치 0
  - warnings: 충족 못 한 제약 사람이 읽는 설명
"""

from __future__ import annotations

import random
from typing import Any


def _as_pairs(raw: Any) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for p in raw or []:
        if isinstance(p, (list, tuple)) and len(p) == 2 and p[0] and p[1]:
            a, b = str(p[0]), str(p[1])
            if a != b:
                out.append((a, b))
    return out


def seats_of_desk(desk: dict) -> list[str]:
    n = 2 if int(desk.get("seats", 1) or 1) >= 2 else 1
    return [f'{desk["id"]}.{i}' for i in range(n)]


def build_desk_adjacency(desks: list[dict], aisles: Any) -> dict[str, set[str]]:
    """이웃 책상 맵 — 맨해튼 1, 가로는 통로(aisle)로 끊김."""
    aisle_set = {int(a) for a in (aisles or []) if isinstance(a, (int, float))}
    by_pos: dict[tuple[int, int], str] = {}
    for d in desks:
        by_pos[(int(d["row"]), int(d["col"]))] = str(d["id"])
    adj: dict[str, set[str]] = {str(d["id"]): set() for d in desks}
    for d in desks:
        did = str(d["id"])
        r, c = int(d["row"]), int(d["col"])
        right = by_pos.get((r, c + 1))
        if right and c not in aisle_set:          # 가로 이웃 (통로 없을 때만)
            adj[did].add(right)
            adj[right].add(did)
        down = by_pos.get((r + 1, c))             # 세로 이웃 (앞/뒤)
        if down:
            adj[did].add(down)
            adj[down].add(did)
    return adj


def _normalize_desks(layout: dict) -> list[dict]:
    desks: list[dict] = []
    seen: set[str] = set()
    for d in (layout.get("desks") or []):
        if not isinstance(d, dict) or d.get("id") is None:
            continue
        did = str(d["id"])
        if did in seen:
            continue
        seen.add(did)
        try:
            desks.append({
                "id": did,
                "row": int(d.get("row", 0)),
                "col": int(d.get("col", 0)),
                "seats": 2 if int(d.get("seats", 1) or 1) >= 2 else 1,
            })
        except (ValueError, TypeError):
            continue
    return desks


def solve_seating(
    layout: dict,
    roster_keys: list[str],
    constraints: dict | None,
    *,
    seed: int | None = None,
    attempts: int = 800,
) -> dict[str, Any]:
    rng = random.Random(seed)
    constraints = constraints or {}

    desks = _normalize_desks(layout or {})
    desk_ids = {d["id"] for d in desks}
    desk_by_id = {d["id"]: d for d in desks}
    adj = build_desk_adjacency(desks, (layout or {}).get("aisles"))

    seat_desk: dict[str, str] = {}
    desk_seats: dict[str, list[str]] = {}
    for d in desks:
        ss = seats_of_desk(d)
        desk_seats[d["id"]] = ss
        for s in ss:
            seat_desk[s] = d["id"]

    keys = [str(k) for k in roster_keys]
    key_set = set(keys)
    excluded = {str(x) for x in (constraints.get("excluded") or []) if str(x) in key_set}
    placeable = [k for k in keys if k not in excluded]
    placeable_set = set(placeable)

    forbidden: set[frozenset[str]] = set()
    for a, b in _as_pairs(constraints.get("forbidden_pairs")):
        if a in placeable_set and b in placeable_set:
            forbidden.add(frozenset((a, b)))

    # fixed — 좌석이 실제 존재하고 placeable인 것만
    fixed: dict[str, str] = {}
    fixed_seat_used: set[str] = set()
    for k, seat in (constraints.get("fixed") or {}).items():
        k, seat = str(k), str(seat)
        if k in placeable_set and seat in seat_desk and seat not in fixed_seat_used:
            fixed[k] = seat
            fixed_seat_used.add(seat)
    fixed_keys = set(fixed)

    # keep_together — 둘 다 placeable이고 fixed 아닌 쌍만 (한 key는 한 쌍에만)
    together: list[tuple[str, str]] = []
    together_members: set[str] = set()
    for a, b in _as_pairs(constraints.get("keep_together")):
        if a in placeable_set and b in placeable_set \
                and a not in fixed_keys and b not in fixed_keys \
                and a not in together_members and b not in together_members:
            together.append((a, b))
            together_members.add(a)
            together_members.add(b)

    # alone — placeable, fixed/together 아닌 것만
    alone = [
        str(k) for k in (constraints.get("alone") or [])
        if str(k) in placeable_set and str(k) not in fixed_keys
        and str(k) not in together_members
    ]
    alone_set = set(alone)

    singles = [
        k for k in placeable
        if k not in fixed_keys and k not in together_members and k not in alone_set
    ]

    warnings: list[str] = []

    def _one_attempt() -> dict[str, Any]:
        # 책상별 점유자 (인접 검사용) + 좌석 점유
        occ: dict[str, list[str]] = {d["id"]: [] for d in desks}
        seat_taken: dict[str, str] = {}     # seatId -> key
        blocked_seats: set[str] = set()     # alone이 점유한 2인 책상의 빈 옆자리
        struct_fail: list[str] = []

        def neighbors_keys(desk_id: str) -> list[str]:
            out = list(occ.get(desk_id, []))
            for nd in adj.get(desk_id, ()):  # 이웃 책상
                out.extend(occ.get(nd, []))
            return out

        def conflict(key: str, desk_id: str) -> bool:
            for n in neighbors_keys(desk_id):
                if frozenset((key, n)) in forbidden:
                    return True
            return False

        def place(key: str, seat: str) -> None:
            seat_taken[seat] = key
            occ[seat_desk[seat]].append(key)

        # 1) fixed
        for k, seat in fixed.items():
            place(k, seat)

        def free_seats_in(desk_id: str) -> list[str]:
            return [s for s in desk_seats[desk_id]
                    if s not in seat_taken and s not in blocked_seats]

        def is_desk_empty(desk_id: str) -> bool:
            return len(occ[desk_id]) == 0 and not any(
                s in blocked_seats for s in desk_seats[desk_id]
            )

        # 2) keep_together — 비어있는 2인 책상
        free_pair_desks = [
            d["id"] for d in desks
            if d["seats"] == 2 and is_desk_empty(d["id"])
        ]
        rng.shuffle(free_pair_desks)
        for a, b in together:
            cand = None
            # forbidden과 안 부딪히는 책상 우선
            for i, did in enumerate(free_pair_desks):
                if not conflict(a, did) and not conflict(b, did):
                    cand = free_pair_desks.pop(i)
                    break
            if cand is None and free_pair_desks:
                cand = free_pair_desks.pop()  # 충돌 감수
            if cand is None:
                struct_fail.append("together")
                continue
            s0, s1 = desk_seats[cand][0], desk_seats[cand][1]
            place(a, s0)
            place(b, s1)

        # 3) alone — 빈 책상 독점 (1인 책상 우선, 없으면 2인 책상 옆자리 빈칸)
        free_single_desks = [
            d["id"] for d in desks if d["seats"] == 1 and is_desk_empty(d["id"])
        ]
        rng.shuffle(free_single_desks)
        free_pair_for_alone = [
            d["id"] for d in desks if d["seats"] == 2 and is_desk_empty(d["id"])
        ]
        rng.shuffle(free_pair_for_alone)
        for k in alone:
            did = None
            # 충돌 없는 1인 책상
            for i, cand in enumerate(free_single_desks):
                if not conflict(k, cand):
                    did = free_single_desks.pop(i)
                    break
            if did is not None:
                place(k, desk_seats[did][0])
                continue
            # 충돌 없는 2인 책상 (옆자리 차단)
            chosen = None
            for i, cand in enumerate(free_pair_for_alone):
                if not conflict(k, cand):
                    chosen = free_pair_for_alone.pop(i)
                    break
            if chosen is None and free_single_desks:
                chosen = free_single_desks.pop()
                place(k, desk_seats[chosen][0])
                continue
            if chosen is None and free_pair_for_alone:
                chosen = free_pair_for_alone.pop()
            if chosen is None:
                struct_fail.append("alone")
                continue
            place(k, desk_seats[chosen][0])
            blocked_seats.add(desk_seats[chosen][1])  # 옆자리 빈칸 유지

        # 4) singles — 충돌 없는 좌석 우선 그리디
        open_seats = [
            s for s in seat_desk
            if s not in seat_taken and s not in blocked_seats
        ]
        rng.shuffle(open_seats)
        order = singles[:]
        rng.shuffle(order)
        unplaced: list[str] = []
        for k in order:
            chosen_seat = None
            for s in open_seats:
                if s in seat_taken or s in blocked_seats:
                    continue
                if not conflict(k, seat_desk[s]):
                    chosen_seat = s
                    break
            if chosen_seat is None:
                # 충돌 무시하고 아무 빈자리
                for s in open_seats:
                    if s not in seat_taken and s not in blocked_seats:
                        chosen_seat = s
                        break
            if chosen_seat is None:
                unplaced.append(k)  # 자리 부족
                continue
            place(k, chosen_seat)

        violations = _count_violations(seat_taken, seat_desk, adj, forbidden)
        return {
            "assignment": dict(seat_taken),
            "violations": violations,
            "unplaced": unplaced,
            "struct_fail": struct_fail,
        }

    best: dict[str, Any] | None = None

    def score(r: dict) -> tuple:
        # 낮을수록 좋음: 구조 실패 → 미배치 → 인접 위반
        return (len(r["struct_fail"]), len(r["unplaced"]), r["violations"])

    n = max(1, attempts)
    for _ in range(n):
        r = _one_attempt()
        if best is None or score(r) < score(best):
            best = r
        if score(r) == (0, 0, 0):
            break

    assert best is not None

    if best["struct_fail"]:
        if "together" in best["struct_fail"]:
            warnings.append("‘짝으로 앉기’를 모두 배치할 빈 2인 책상이 부족합니다.")
        if "alone" in best["struct_fail"]:
            warnings.append("‘혼자 앉기’를 모두 배치할 빈 책상이 부족합니다.")
    if best["unplaced"]:
        warnings.append(f"좌석이 부족해 {len(best['unplaced'])}명이 배치되지 않았습니다.")
    if best["violations"]:
        warnings.append(
            f"‘인접 금지’ 조건 {best['violations']}건을 모두 지키지 못했습니다 "
            "(자리·조건이 너무 빡빡할 수 있어요)."
        )

    return {
        "assignment": best["assignment"],
        "warnings": warnings,
        "satisfied": not warnings,
        "unplaced": best["unplaced"],
    }


def _count_violations(
    seat_taken: dict[str, str],
    seat_desk: dict[str, str],
    adj: dict[str, set[str]],
    forbidden: set[frozenset[str]],
) -> int:
    """배치 결과에서 인접 금지 위반 쌍 수 (중복 없이)."""
    if not forbidden:
        return 0
    key_seat: dict[str, str] = {k: s for s, k in seat_taken.items()}
    violated: set[frozenset[str]] = set()
    for pair in forbidden:
        a, b = tuple(pair)
        sa_, sb = key_seat.get(a), key_seat.get(b)
        if sa_ is None or sb is None:
            continue
        da, db = seat_desk[sa_], seat_desk[sb]
        if da == db or db in adj.get(da, ()):
            violated.add(pair)
    return len(violated)
