"""자리배치 — 솔버(순수) + API(CRUD·shuffle·IDOR·담임 명단).

솔버 테스트는 DB 비의존. API 테스트는 app_client + teacher_user fixture.
"""

import pytest

from app.services.seating_solver import build_desk_adjacency, solve_seating


# ─────────────────────────────────────────────────────────────────────────────
# 솔버 (순수 함수)
# ─────────────────────────────────────────────────────────────────────────────

def _layout(rows, cols, seats=2, aisles=None):
    desks = [
        {"id": f"r{r}c{c}", "row": r, "col": c, "seats": seats}
        for r in range(rows) for c in range(cols)
    ]
    return {"rows": rows, "cols": cols, "desks": desks, "aisles": aisles or []}


def _desk(sid: str) -> str:
    return sid.split(".")[0]


def _are_adjacent(layout, sid_a, sid_b) -> bool:
    da, db = _desk(sid_a), _desk(sid_b)
    if da == db:
        return True
    adj = build_desk_adjacency(layout["desks"], layout.get("aisles"))
    return db in adj.get(da, set())


def test_full_placement():
    layout = _layout(1, 3, seats=2)  # 6석
    keys = [f"s{i}" for i in range(6)]
    r = solve_seating(layout, keys, {}, seed=1)
    assert r["satisfied"] is True
    assert len(r["assignment"]) == 6
    assert set(r["assignment"].values()) == set(keys)
    assert r["unplaced"] == []


def test_excluded_not_placed():
    layout = _layout(2, 2, seats=2)
    keys = ["a", "b", "c"]
    r = solve_seating(layout, keys, {"excluded": ["c"]}, seed=2)
    placed = set(r["assignment"].values())
    assert "c" not in placed
    assert {"a", "b"} <= placed
    assert r["satisfied"] is True


def test_fixed_seat_kept():
    layout = _layout(2, 2, seats=2)
    keys = ["a", "b", "c", "d"]
    seat = "r0c0.0"
    r = solve_seating(layout, keys, {"fixed": {"a": seat}}, seed=3)
    assert r["assignment"][seat] == "a"


def test_keep_together_same_desk():
    layout = _layout(1, 3, seats=2)
    keys = ["a", "b", "c", "d"]
    r = solve_seating(layout, keys, {"keep_together": [["a", "b"]]}, seed=4)
    inv = {v: k for k, v in r["assignment"].items()}
    assert _desk(inv["a"]) == _desk(inv["b"])
    assert r["satisfied"] is True


def test_alone_blocks_partner():
    layout = _layout(1, 2, seats=2)  # 2 pair desks, 4 seats
    keys = ["a", "b", "c"]
    r = solve_seating(layout, keys, {"alone": ["a"]}, seed=5)
    inv = {v: k for k, v in r["assignment"].items()}
    a_desk = _desk(inv["a"])
    # a의 책상에는 a만 (옆자리 비어 있어야)
    same_desk_occupants = [v for s, v in r["assignment"].items() if _desk(s) == a_desk]
    assert same_desk_occupants == ["a"]
    assert r["satisfied"] is True


def test_forbidden_respected_when_feasible():
    layout = _layout(3, 3, seats=2)  # 넉넉
    keys = ["a", "b", "c", "d"]
    r = solve_seating(layout, keys, {"forbidden_pairs": [["a", "b"]]}, seed=6)
    inv = {v: k for k, v in r["assignment"].items()}
    assert not _are_adjacent(layout, inv["a"], inv["b"])
    assert r["satisfied"] is True


def test_aisle_breaks_adjacency():
    # 통로가 두 책상 사이를 끊으면 인접 금지 충족 가능
    layout = _layout(1, 2, seats=2, aisles=[0])
    keys = ["a", "b"]
    r = solve_seating(layout, keys, {"forbidden_pairs": [["a", "b"]]}, seed=7)
    inv = {v: k for k, v in r["assignment"].items()}
    assert not _are_adjacent(layout, inv["a"], inv["b"])
    assert r["satisfied"] is True


def test_infeasible_forbidden_warns():
    # 통로 없는 1x2: 두 책상이 이웃 → 두 학생을 떼어놓을 수 없음
    layout = _layout(1, 2, seats=2, aisles=[])
    keys = ["a", "b"]
    r = solve_seating(layout, keys, {"forbidden_pairs": [["a", "b"]]}, seed=8)
    assert r["satisfied"] is False
    assert any("인접 금지" in w for w in r["warnings"])


def test_overflow_unplaced_warns():
    layout = _layout(1, 1, seats=1)  # 1석
    keys = ["a", "b", "c"]
    r = solve_seating(layout, keys, {}, seed=9)
    assert len(r["unplaced"]) == 2
    assert r["satisfied"] is False


# ─────────────────────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────────────────────

def _api_layout():
    desks = [
        {"id": f"r{r}c{c}", "row": r, "col": c, "seats": 2}
        for r in range(3) for c in range(3)
    ]
    return {"rows": 3, "cols": 3, "desks": desks, "aisles": [], "doors": [], "podium": None}


@pytest.mark.asyncio
async def test_seating_crud_and_shuffle(app_client, teacher_user, auth_headers, db_session):
    await db_session.commit()  # 첫 요청 전 fixture 확정 (in-memory 공유 커넥션 안전)
    h = auth_headers(teacher_user)

    body = {
        "title": "3반 자리",
        "layout": _api_layout(),
        "roster": [{"key": f"s{i}", "name": f"학생{i}"} for i in range(4)],
        "constraints": {"forbidden_pairs": [["s0", "s1"]]},
    }
    res = await app_client.post("/api/tools/seating", json=body, headers=h)
    assert res.status_code == 200, res.text
    cid = res.json()["id"]

    # 목록
    lst = await app_client.get("/api/tools/seating", headers=h)
    assert lst.status_code == 200
    assert any(c["id"] == cid for c in lst.json()["items"])

    # 상세
    got = await app_client.get(f"/api/tools/seating/{cid}", headers=h)
    assert got.status_code == 200
    assert got.json()["roster_count"] == 4

    # 랜덤 배치 — 넉넉한 교실이라 인접 금지 충족
    sh = await app_client.post(f"/api/tools/seating/{cid}/shuffle", json={"save": True}, headers=h)
    assert sh.status_code == 200, sh.text
    data = sh.json()
    assert data["satisfied"] is True
    assert set(data["assignment"].values()) == {"s0", "s1", "s2", "s3"}

    # 저장됐는지 재조회
    got2 = await app_client.get(f"/api/tools/seating/{cid}", headers=h)
    assert len(got2.json()["assignment"]) == 4


@pytest.mark.asyncio
async def test_seating_shuffle_requires_desks(app_client, teacher_user, auth_headers, db_session):
    await db_session.commit()
    h = auth_headers(teacher_user)
    res = await app_client.post(
        "/api/tools/seating",
        json={"title": "빈 교실", "roster": [{"key": "a", "name": "A"}]},
        headers=h,
    )
    cid = res.json()["id"]
    sh = await app_client.post(f"/api/tools/seating/{cid}/shuffle", json={}, headers=h)
    assert sh.status_code == 400  # 책상 없음


@pytest.mark.asyncio
async def test_seating_idor(app_client, teacher_user, auth_headers, db_session):
    # 소유자 생성 (첫 요청이 commit → fixture 확정)
    h = auth_headers(teacher_user)
    await db_session.commit()
    res = await app_client.post("/api/tools/seating", json={"title": "내 것"}, headers=h)
    cid = res.json()["id"]

    # 다른 교사 — 소유자 아님 → 403
    from app.core.auth import create_access_token, hash_password
    from app.core.quota import assign_default_quota
    from app.models.user import User
    other = User(
        email="t2@test.local", name="T2", role="teacher", username="t2",
        password_hash=hash_password("TestPass123!"), status="approved",
        must_change_password=False,
    )
    assign_default_quota(other)
    db_session.add(other)
    await db_session.flush()
    await db_session.refresh(other)
    await db_session.commit()
    h2 = {"Authorization": f"Bearer {create_access_token(other.id, other.role)}"}

    got = await app_client.get(f"/api/tools/seating/{cid}", headers=h2)
    assert got.status_code == 403


@pytest.mark.asyncio
async def test_seating_delete_soft(app_client, teacher_user, auth_headers, db_session):
    await db_session.commit()
    h = auth_headers(teacher_user)
    res = await app_client.post("/api/tools/seating", json={"title": "삭제용"}, headers=h)
    cid = res.json()["id"]
    d = await app_client.delete(f"/api/tools/seating/{cid}", headers=h)
    assert d.status_code == 200
    # 휴지통 이동 → 목록·상세에서 제외
    lst = await app_client.get("/api/tools/seating", headers=h)
    assert all(c["id"] != cid for c in lst.json()["items"])
    got = await app_client.get(f"/api/tools/seating/{cid}", headers=h)
    assert got.status_code == 404


@pytest.mark.asyncio
async def test_homeroom_roster_shape(app_client, teacher_user, auth_headers, db_session):
    await db_session.commit()
    h = auth_headers(teacher_user)
    res = await app_client.get("/api/tools/seating/_homeroom", headers=h)
    assert res.status_code == 200
    data = res.json()
    assert "label" in data and "students" in data
    assert isinstance(data["students"], list)
