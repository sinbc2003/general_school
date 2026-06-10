"""업무 및 수업 도구 (라이브 퀴즈 / 단어장 / 보드) 통합 테스트.

커버:
  - 라이브 퀴즈: 세션 생성(자동채점 필터) → PIN 입장 → 상태머신 전체 흐름
    → 점수/중복제출/마스킹 → IDOR (학생 host 불가, 타 교사 제어 불가)
  - 단어장: CRUD + 학습 접근 가드 (비공개/공개/강좌 첨부) + 라이트너 진도 + CSV
  - 보드: 권한 매트릭스 (members/public/첨부/보관) + yjs-snapshot 내부 토큰
"""

from datetime import date

import pytest
import pytest_asyncio

from tests.conftest import _create_user


pytestmark = pytest.mark.asyncio


# ── 공통 fixture ─────────────────────────────────────────────

@pytest_asyncio.fixture
async def teacher2(db_session, seed_perms):
    return await _create_user(
        db_session, email="teacher2@test.local", name="Teacher Two", role="teacher",
    )


@pytest_asyncio.fixture
async def student2(db_session, seed_perms):
    return await _create_user(
        db_session, email="student2@test.local", name="Student Two",
        role="student", grade=2, class_number=3, student_number=16,
    )


@pytest_asyncio.fixture
async def course(db_session, teacher_user, student_user):
    """현재 학기 + 강좌 + 수강생(student_user) 등록."""
    from app.models import Course, CourseStudent, Semester

    sem = Semester(
        year=2026, semester=1, name="2026-1학기",
        start_date=date(2026, 3, 1), end_date=date(2026, 8, 31),
        is_current=True,
    )
    db_session.add(sem)
    await db_session.flush()

    c = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="수학", name="수학 A반",
    )
    db_session.add(c)
    await db_session.flush()

    db_session.add(CourseStudent(course_id=c.id, student_id=student_user.id, status="active"))
    await db_session.flush()
    await db_session.commit()
    return c


def _mk_problem(creator_id: int, **kw):
    from app.models import Problem
    base = dict(
        department="math", subject="수학", difficulty="medium",
        question_type="multiple_choice", content="문제",
        is_visible=True, review_status="pending", created_by_id=creator_id,
    )
    base.update(kw)
    return Problem(**base)


@pytest_asyncio.fixture
async def problem_set(db_session, course, teacher_user):
    """객관식 + 수치형 (자동채점 2) + 서술형 (제외 대상 1)."""
    from app.models import CourseProblemSet

    p1 = _mk_problem(
        teacher_user.id, content="2+2=?", question_type="multiple_choice",
        answer="A",
        answer_data={"grader_type": "choices", "correct": ["A"], "choices": ["4", "5", "6", "7"]},
    )
    p2 = _mk_problem(
        teacher_user.id, content="원주율 소수 둘째자리까지?", question_type="numeric",
        answer="3.14",
        answer_data={"grader_type": "numeric", "value": 3.14, "tolerance": 0.01},
    )
    p3 = _mk_problem(
        teacher_user.id, content="증명하시오", question_type="essay",
        answer_data={"grader_type": "essay", "rubric": "논리"},
    )
    db_session.add_all([p1, p2, p3])
    await db_session.flush()

    ps = CourseProblemSet(
        course_id=course.id, title="퀴즈용 세트",
        problem_ids=[p1.id, p2.id, p3.id], status="published",
        created_by=teacher_user.id,
    )
    db_session.add(ps)
    await db_session.flush()
    await db_session.commit()
    ps._p1, ps._p2, ps._p3 = p1.id, p2.id, p3.id  # 테스트 편의
    return ps


# ─────────────────────────────────────────────────────────────
# 라이브 퀴즈
# ─────────────────────────────────────────────────────────────

async def _create_quiz(app_client, auth_headers, teacher_user, problem_set):
    res = await app_client.post(
        "/api/tools/quiz/sessions",
        json={"problem_set_id": problem_set.id, "settings": {"time_per_question": 30}},
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200, res.text
    return res.json()


async def test_quiz_create_filters_auto_gradable(
    app_client, auth_headers, teacher_user, problem_set,
):
    data = await _create_quiz(app_client, auth_headers, teacher_user, problem_set)
    assert data["problem_count"] == 2          # essay 1개 제외
    assert data["skipped_problems"] == 1
    assert len(data["pin"]) == 6 and data["pin"].isdigit()


async def test_quiz_student_cannot_host(
    app_client, auth_headers, student_user, problem_set,
):
    res = await app_client.post(
        "/api/tools/quiz/sessions",
        json={"problem_set_id": problem_set.id},
        headers=auth_headers(student_user),
    )
    assert res.status_code == 403


async def test_quiz_non_editor_teacher_cannot_use_problem_set(
    app_client, auth_headers, teacher2, problem_set,
):
    res = await app_client.post(
        "/api/tools/quiz/sessions",
        json={"problem_set_id": problem_set.id},
        headers=auth_headers(teacher2),
    )
    assert res.status_code == 403


async def test_quiz_full_flow(
    app_client, auth_headers, teacher_user, student_user, problem_set,
):
    t = auth_headers(teacher_user)
    s = auth_headers(student_user)
    quiz = await _create_quiz(app_client, auth_headers, teacher_user, problem_set)
    sid, pin = quiz["id"], quiz["pin"]

    # 입장 (멱등 — 재입장 시 같은 player)
    j1 = (await app_client.post("/api/tools/quiz/join", json={"pin": pin}, headers=s)).json()
    j2 = (await app_client.post("/api/tools/quiz/join", json={"pin": pin}, headers=s)).json()
    assert j1["session_id"] == sid and j1["player_id"] == j2["player_id"]

    # 로비 중 답안 → 409
    res = await app_client.post(
        f"/api/tools/quiz/play/{sid}/answer", json={"answer": {"selected": ["A"]}}, headers=s,
    )
    assert res.status_code == 409

    # 시작 → 문제 1 (객관식)
    assert (await app_client.post(f"/api/tools/quiz/sessions/{sid}/start", headers=t)).status_code == 200
    state = (await app_client.get(f"/api/tools/quiz/play/{sid}/state", headers=s)).json()
    assert state["status"] == "question" and state["current_index"] == 0
    # 정답 마스킹 — 보기만 노출
    assert "choices" in state["question"]
    assert "answer" not in state["question"] and "correct" not in state["question"]

    # 정답 제출 → 점수 (1000 × 속도보정, 즉시 제출이라 500 초과)
    res = await app_client.post(
        f"/api/tools/quiz/play/{sid}/answer", json={"answer": {"selected": ["A"]}}, headers=s,
    )
    body = res.json()
    assert res.status_code == 200 and body["is_correct"] is True and body["points"] > 500

    # 중복 제출 → 409
    res = await app_client.post(
        f"/api/tools/quiz/play/{sid}/answer", json={"answer": {"selected": ["B"]}}, headers=s,
    )
    assert res.status_code == 409

    # 공개 → 학생 결과 + 호스트 분포
    assert (await app_client.post(f"/api/tools/quiz/sessions/{sid}/reveal", headers=t)).status_code == 200
    state = (await app_client.get(f"/api/tools/quiz/play/{sid}/state", headers=s)).json()
    assert state["status"] == "reveal"
    assert state["my_result"]["is_correct"] is True
    assert state["correct_display"]  # 정답 표시
    host = (await app_client.get(f"/api/tools/quiz/sessions/{sid}", headers=t)).json()
    assert host["correct_count"] == 1 and host["distribution"].get("A") == 1

    # 다음 → 문제 2 (수치형) — 오답 제출 → 0점
    assert (await app_client.post(f"/api/tools/quiz/sessions/{sid}/next", headers=t)).status_code == 200
    res = await app_client.post(
        f"/api/tools/quiz/play/{sid}/answer", json={"answer": {"value": 999}}, headers=s,
    )
    assert res.json()["is_correct"] is False and res.json()["points"] == 0

    # 마지막 문제 reveal → next → ended
    assert (await app_client.post(f"/api/tools/quiz/sessions/{sid}/reveal", headers=t)).status_code == 200
    assert (await app_client.post(f"/api/tools/quiz/sessions/{sid}/next", headers=t)).json()["status"] == "ended"
    state = (await app_client.get(f"/api/tools/quiz/play/{sid}/state", headers=s)).json()
    assert state["status"] == "ended" and state["leaderboard"][0]["score"] > 0


async def test_quiz_other_teacher_cannot_control(
    app_client, auth_headers, teacher_user, teacher2, problem_set,
):
    quiz = await _create_quiz(app_client, auth_headers, teacher_user, problem_set)
    res = await app_client.post(
        f"/api/tools/quiz/sessions/{quiz['id']}/start", headers=auth_headers(teacher2),
    )
    assert res.status_code == 403


async def test_quiz_info_pin_disclosure_scope(
    app_client, auth_headers, teacher_user, student_user, student2,
    problem_set, course, db_session,
):
    """info 엔드포인트 PIN 노출: host OK / 무관 사용자 차단 / 첨부 강좌 수강생 OK."""
    from app.models import CoursePost

    quiz = await _create_quiz(app_client, auth_headers, teacher_user, problem_set)
    sid = quiz["id"]

    # host → pin 보임
    info = (await app_client.get(f"/api/tools/quiz/info/{sid}", headers=auth_headers(teacher_user))).json()
    assert info["pin"] == quiz["pin"] and info["is_host"] is True

    # 첨부 없는 상태 — 수강생도 pin 안 보임 (sid 열거 차단)
    info = (await app_client.get(f"/api/tools/quiz/info/{sid}", headers=auth_headers(student_user))).json()
    assert info["pin"] is None

    # 강좌 글에 첨부 → 수강생 pin 보임, 비수강생은 여전히 차단
    db_session.add(CoursePost(
        course_id=course.id, author_id=teacher_user.id,
        post_type="material", title="퀴즈", content="x",
        attachments=[{"type": "live_quiz", "live_quiz_id": sid, "title": quiz["title"]}],
    ))
    await db_session.commit()
    info = (await app_client.get(f"/api/tools/quiz/info/{sid}", headers=auth_headers(student_user))).json()
    assert info["pin"] == quiz["pin"]
    info = (await app_client.get(f"/api/tools/quiz/info/{sid}", headers=auth_headers(student2))).json()
    assert info["pin"] is None


# ─────────────────────────────────────────────────────────────
# 단어장
# ─────────────────────────────────────────────────────────────

async def _create_deck(app_client, headers, **kw):
    body = {"title": "기본 영단어", **kw}
    res = await app_client.post("/api/tools/wordbook/decks", json=body, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def test_wordbook_access_and_leitner(
    app_client, auth_headers, teacher_user, student_user,
):
    t = auth_headers(teacher_user)
    s = auth_headers(student_user)
    deck = await _create_deck(app_client, t)
    did = deck["id"]
    card = (await app_client.post(
        f"/api/tools/wordbook/decks/{did}/cards",
        json={"term": "apple", "meaning": "사과"}, headers=t,
    )).json()

    # 비공개 + 첨부 없음 → 학생 403
    assert (await app_client.get(f"/api/tools/wordbook/decks/{did}/study", headers=s)).status_code == 403

    # 공개 → 200
    await app_client.put(f"/api/tools/wordbook/decks/{did}", json={"is_public": True}, headers=t)
    study = (await app_client.get(f"/api/tools/wordbook/decks/{did}/study", headers=s)).json()
    assert len(study["cards"]) == 1

    # 라이트너: 정답 → box 2, 또 정답 → 3, 오답 → 1로 리셋
    for expected, correct in [(2, True), (3, True), (1, False)]:
        res = (await app_client.post(
            f"/api/tools/wordbook/decks/{did}/progress",
            json={"card_id": card["id"], "correct": correct}, headers=s,
        )).json()
        assert res["box"] == expected


async def test_wordbook_idor(
    app_client, auth_headers, teacher_user, teacher2, student_user,
):
    t = auth_headers(teacher_user)
    deck = await _create_deck(app_client, t)
    did = deck["id"]
    # 타 교사 편집/조회 차단
    assert (await app_client.put(
        f"/api/tools/wordbook/decks/{did}", json={"title": "탈취"}, headers=auth_headers(teacher2),
    )).status_code == 403
    assert (await app_client.get(
        f"/api/tools/wordbook/decks/{did}", headers=auth_headers(teacher2),
    )).status_code == 403
    # 학생은 manage 권한 자체가 없음
    assert (await app_client.post(
        "/api/tools/wordbook/decks", json={"title": "x"}, headers=auth_headers(student_user),
    )).status_code == 403


async def test_wordbook_csv_import(app_client, auth_headers, teacher_user):
    t = auth_headers(teacher_user)
    deck = await _create_deck(app_client, t)
    csv_bytes = "단어,뜻,예문\napple,사과,I ate an apple.\nrun,달리다,\n,빈단어스킵,\n".encode("utf-8-sig")
    res = await app_client.post(
        f"/api/tools/wordbook/decks/{deck['id']}/cards/_import",
        files={"file": ("words.csv", csv_bytes, "text/csv")},
        headers=t,
    )
    body = res.json()
    assert res.status_code == 200, res.text
    assert body["added"] == 2 and body["skipped"] == 1


async def test_wordbook_classroom_attachment_grants_study(
    app_client, auth_headers, teacher_user, student_user, student2, course, db_session,
):
    """강좌 글에 word_deck 첨부 → 그 강좌 수강생만 학습 가능."""
    from app.models import CoursePost

    t = auth_headers(teacher_user)
    deck = await _create_deck(app_client, t)  # 비공개
    did = deck["id"]

    # 첨부 전 — 수강생도 403
    res = await app_client.get(f"/api/tools/wordbook/decks/{did}/study", headers=auth_headers(student_user))
    assert res.status_code == 403

    # 강좌 글에 word_deck 첨부 (DB 직접 — 글 작성 API와 동일 형식)
    db_session.add(CoursePost(
        course_id=course.id, author_id=teacher_user.id,
        post_type="material", title="단어장 첨부", content="x",
        attachments=[{"type": "word_deck", "word_deck_id": did, "title": deck["title"]}],
    ))
    await db_session.commit()

    # 수강생 → 200
    assert (await app_client.get(
        f"/api/tools/wordbook/decks/{did}/study", headers=auth_headers(student_user),
    )).status_code == 200
    # 비수강생 → 403
    assert (await app_client.get(
        f"/api/tools/wordbook/decks/{did}/study", headers=auth_headers(student2),
    )).status_code == 403


# ─────────────────────────────────────────────────────────────
# 보드
# ─────────────────────────────────────────────────────────────

async def _create_board(app_client, headers, **kw):
    body = {"title": "아이디어 보드", **kw}
    res = await app_client.post("/api/classroom/boards", json=body, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def test_board_access_matrix(
    app_client, auth_headers, teacher_user, student_user,
):
    t = auth_headers(teacher_user)
    s = auth_headers(student_user)
    board = await _create_board(app_client, t)  # members 모드, 강좌 미연결
    bid = board["id"]
    assert board["columns"] == ["아이디어", "질문", "기타"]

    # members + 첨부 없음 → 학생 403
    assert (await app_client.get(f"/api/classroom/boards/{bid}", headers=s)).status_code == 403

    # public → 학생 읽기+쓰기
    await app_client.put(f"/api/classroom/boards/{bid}", json={"access_mode": "public"}, headers=t)
    res = (await app_client.get(f"/api/classroom/boards/{bid}", headers=s)).json()
    assert res["permission"]["can_read"] is True and res["permission"]["can_write"] is True

    # 보관 → 쓰기 차단 (읽기는 유지)
    await app_client.put(f"/api/classroom/boards/{bid}", json={"is_archived": True}, headers=t)
    perm = (await app_client.get(f"/api/classroom/boards/{bid}/permission", headers=s)).json()
    assert perm["can_read"] is True and perm["can_write"] is False


async def test_board_course_member_access(
    app_client, auth_headers, teacher_user, student_user, student2, course,
):
    t = auth_headers(teacher_user)
    board = await _create_board(app_client, t, course_id=course.id)
    bid = board["id"]
    # 수강생 → 쓰기 OK
    perm = (await app_client.get(
        f"/api/classroom/boards/{bid}/permission", headers=auth_headers(student_user),
    )).json()
    assert perm["can_write"] is True
    # 비수강생 → 차단
    perm2 = (await app_client.get(
        f"/api/classroom/boards/{bid}/permission", headers=auth_headers(student2),
    )).json()
    assert perm2["can_read"] is False


async def test_board_idor_and_student_cannot_manage(
    app_client, auth_headers, teacher_user, teacher2, student_user,
):
    t = auth_headers(teacher_user)
    board = await _create_board(app_client, t)
    bid = board["id"]
    assert (await app_client.put(
        f"/api/classroom/boards/{bid}", json={"title": "탈취"}, headers=auth_headers(teacher2),
    )).status_code == 403
    assert (await app_client.delete(
        f"/api/classroom/boards/{bid}", headers=auth_headers(teacher2),
    )).status_code == 403
    assert (await app_client.post(
        "/api/classroom/boards", json={"title": "x"}, headers=auth_headers(student_user),
    )).status_code == 403


async def test_board_yjs_snapshot_internal_token(
    app_client, auth_headers, teacher_user, monkeypatch,
):
    import base64
    from app.core.config import settings

    t = auth_headers(teacher_user)
    board = await _create_board(app_client, t)
    bid = board["id"]
    payload = {"state_base64": base64.b64encode(b"yjs-test-state").decode()}

    # 토큰 미설정 → 503
    monkeypatch.setattr(settings, "HOCUSPOCUS_INTERNAL_TOKEN", "", raising=False)
    assert (await app_client.post(
        f"/api/classroom/boards/{bid}/yjs-snapshot", json=payload,
    )).status_code == 503

    # 잘못된 토큰 → 401, 올바른 토큰 → 저장/조회 roundtrip
    monkeypatch.setattr(settings, "HOCUSPOCUS_INTERNAL_TOKEN", "test-tok", raising=False)
    assert (await app_client.post(
        f"/api/classroom/boards/{bid}/yjs-snapshot", json=payload,
        headers={"X-Internal-Token": "wrong"},
    )).status_code == 401
    res = await app_client.post(
        f"/api/classroom/boards/{bid}/yjs-snapshot", json=payload,
        headers={"X-Internal-Token": "test-tok"},
    )
    assert res.status_code == 200 and res.json()["byte_size"] == len(b"yjs-test-state")
    got = (await app_client.get(
        f"/api/classroom/boards/{bid}/yjs-snapshot",
        headers={"X-Internal-Token": "test-tok"},
    )).json()
    assert got["state_base64"] == payload["state_base64"]
