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
    # intro_seconds=0 — 테스트는 즉시 제출 (운영 기본은 4초 인트로)
    res = await app_client.post(
        "/api/tools/quiz/sessions",
        json={"problem_set_id": problem_set.id,
              "settings": {"time_per_question": 30, "intro_seconds": 0}},
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


async def test_quiz_direct_create_intro_and_streak(
    app_client, auth_headers, teacher_user, student_user, seed_perms, db_session,
):
    """직접 출제(코스웨어 없이) + 인트로 차단 + 연속 정답 스트릭 보너스."""
    # 403 요청의 rollback이 미커밋 fixture를 지우지 않게 선커밋
    await db_session.commit()
    t = auth_headers(teacher_user)
    s = auth_headers(student_user)

    # 학생은 직접 출제 불가
    assert (await app_client.post("/api/tools/quiz/sessions/direct", json={
        "title": "x", "questions": [{"content": "q", "choices": ["1", "2"], "correct": ["A"]}],
    }, headers=s)).status_code == 403

    # 인트로 동작: intro_seconds=5 → 시작 직후 제출은 409 (문제 공개 전)
    intro_res = await app_client.post("/api/tools/quiz/sessions/direct", json={
        "title": "인트로 테스트",
        "questions": [{"content": "1+1=?", "choices": ["2", "3"], "correct": ["A"]}],
        "settings": {"time_per_question": 30, "intro_seconds": 5},
    }, headers=t)
    assert intro_res.status_code == 200, intro_res.text
    intro_quiz = intro_res.json()
    await app_client.post("/api/tools/quiz/join", json={"pin": intro_quiz["pin"]}, headers=s)
    await app_client.post(f"/api/tools/quiz/sessions/{intro_quiz['id']}/start", headers=t)
    res = await app_client.post(
        f"/api/tools/quiz/play/{intro_quiz['id']}/answer",
        json={"answer": {"selected": ["A"]}}, headers=s,
    )
    assert res.status_code == 409 and "공개 전" in res.json()["detail"]

    # 직접 출제 2문제 (intro 0) — 연속 정답 시 2번째에 스트릭 보너스 +100
    quiz = (await app_client.post("/api/tools/quiz/sessions/direct", json={
        "title": "스트릭 테스트",
        "questions": [
            {"content": "2+2=?", "choices": ["4", "5", "6"], "correct": ["A"]},
            {"content": "3+3=?", "choices": ["5", "6"], "correct": ["B"]},
        ],
        "settings": {"time_per_question": 30, "intro_seconds": 0},
    }, headers=t)).json()
    assert quiz["problem_count"] == 2
    sid = quiz["id"]
    await app_client.post("/api/tools/quiz/join", json={"pin": quiz["pin"]}, headers=s)
    await app_client.post(f"/api/tools/quiz/sessions/{sid}/start", headers=t)

    # 단일 정답 마스킹 + multi 플래그
    state = (await app_client.get(f"/api/tools/quiz/play/{sid}/state", headers=s)).json()
    assert state["question"]["multi"] is False
    assert "correct" not in state["question"]

    r1 = (await app_client.post(
        f"/api/tools/quiz/play/{sid}/answer", json={"answer": {"selected": ["A"]}}, headers=s,
    )).json()
    assert r1["is_correct"] is True and r1["streak"] == 1 and r1["streak_bonus"] == 0

    await app_client.post(f"/api/tools/quiz/sessions/{sid}/reveal", headers=t)
    await app_client.post(f"/api/tools/quiz/sessions/{sid}/next", headers=t)

    r2 = (await app_client.post(
        f"/api/tools/quiz/play/{sid}/answer", json={"answer": {"selected": ["B"]}}, headers=s,
    )).json()
    assert r2["is_correct"] is True and r2["streak"] == 2 and r2["streak_bonus"] == 100
    assert r2["points"] > 1000  # 기본 점수 + 보너스


async def test_quiz_image_upload_and_guard(
    app_client, auth_headers, teacher_user, student_user, seed_perms, db_session,
):
    """문제 이미지 업로드(host만) + files 가드(인증 사용자 누구나 읽기)."""
    import io as _io

    from PIL import Image

    # 403 요청의 rollback이 미커밋 fixture를 지우지 않게 선커밋
    await db_session.commit()
    t = auth_headers(teacher_user)
    s = auth_headers(student_user)
    buf = _io.BytesIO()
    Image.new("RGB", (30, 30), (10, 120, 220)).save(buf, format="PNG")
    png = buf.getvalue()

    # 학생 업로드 → 403 (tools.quiz.host 없음)
    assert (await app_client.post(
        "/api/tools/quiz/upload-image",
        files={"file": ("q.png", png, "image/png")}, headers=s,
    )).status_code == 403

    res = await app_client.post(
        "/api/tools/quiz/upload-image",
        files={"file": ("q.png", png, "image/png")}, headers=t,
    )
    assert res.status_code == 200, res.text
    url = res.json()["url"]
    assert url.startswith("/storage/quiz/")
    api_path = url.replace("/storage/", "/api/files/storage/")
    # 인증 사용자(학생 포함) 읽기 OK, 미인증 401
    assert (await app_client.get(api_path, headers=s)).status_code == 200
    assert (await app_client.get(api_path)).status_code == 401


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


async def test_wordbook_share_and_duplicate(
    app_client, auth_headers, teacher_user, teacher2, student_user, seed_perms,
):
    """공유: 동료 교사 열람 OK·편집 불가, 사본 생성 → 본인 소유, 해제 후 차단."""
    t1 = auth_headers(teacher_user)
    t2 = auth_headers(teacher2)
    deck = await _create_deck(app_client, t1)
    did = deck["id"]
    await app_client.post(f"/api/tools/wordbook/decks/{did}/cards",
                          json={"term": "apple", "meaning": "사과"}, headers=t1)

    # 공유 전 — t2 열람/사본 모두 차단
    assert (await app_client.get(f"/api/tools/wordbook/decks/{did}/study", headers=t2)).status_code == 403
    assert (await app_client.post(f"/api/tools/wordbook/decks/{did}/duplicate", headers=t2)).status_code == 403

    # 학생에게 공유 시도 → 400 (교직원만)
    res = await app_client.post(f"/api/tools/wordbook/decks/{did}/shares",
                                json={"user_id": student_user.id}, headers=t1)
    assert res.status_code == 400

    # t2에게 공유
    res = await app_client.post(f"/api/tools/wordbook/decks/{did}/shares",
                                json={"user_id": teacher2.id}, headers=t1)
    assert res.status_code == 200
    share_id = res.json()["id"]

    # t2: shared-with-me 노출 + 열람 OK + 편집은 여전히 불가
    sh = (await app_client.get("/api/tools/wordbook/shared-with-me", headers=t2)).json()
    assert any(d["id"] == did for d in sh["items"])
    assert (await app_client.get(f"/api/tools/wordbook/decks/{did}/study", headers=t2)).status_code == 200
    assert (await app_client.put(f"/api/tools/wordbook/decks/{did}",
                                 json={"title": "탈취"}, headers=t2)).status_code == 403

    # t2 사본 생성 → 본인 소유 + 카드 복제 + 원본 보존
    copy = (await app_client.post(f"/api/tools/wordbook/decks/{did}/duplicate", headers=t2)).json()
    assert copy["owner_id"] == teacher2.id and copy["card_count"] == 1
    assert "(사본)" in copy["title"]
    my = (await app_client.get(f"/api/tools/wordbook/decks/{copy['id']}", headers=t2)).json()
    assert my["cards"][0]["term"] == "apple"
    orig = (await app_client.get(f"/api/tools/wordbook/decks/{did}", headers=t1)).json()
    assert orig["title"] == deck["title"]  # 원본 그대로

    # 공유 해제 → 열람 차단
    assert (await app_client.delete(
        f"/api/tools/wordbook/decks/{did}/shares/{share_id}", headers=t1,
    )).status_code == 200
    assert (await app_client.get(f"/api/tools/wordbook/decks/{did}/study", headers=t2)).status_code == 403


async def test_board_share_and_duplicate(
    app_client, auth_headers, teacher_user, teacher2, monkeypatch,
):
    """보드 공유: 열람 전용(viewer) + 사본은 yjs_state까지 복제."""
    import base64
    from app.core.config import settings

    t1 = auth_headers(teacher_user)
    t2 = auth_headers(teacher2)
    board = await _create_board(app_client, t1)
    bid = board["id"]

    # 카드 데이터(yjs_state) 저장 — 내부 토큰 경유
    monkeypatch.setattr(settings, "HOCUSPOCUS_INTERNAL_TOKEN", "tok", raising=False)
    state = base64.b64encode(b"cards-state").decode()
    await app_client.post(f"/api/classroom/boards/{bid}/yjs-snapshot",
                          json={"state_base64": state}, headers={"X-Internal-Token": "tok"})

    # 공유 전 t2 차단
    assert (await app_client.get(f"/api/classroom/boards/{bid}", headers=t2)).status_code == 403

    # 공유 → viewer (읽기만)
    await app_client.post(f"/api/classroom/boards/{bid}/shares",
                          json={"user_id": teacher2.id}, headers=t1)
    got = (await app_client.get(f"/api/classroom/boards/{bid}", headers=t2)).json()
    assert got["permission"]["can_read"] is True
    assert got["permission"]["can_write"] is False
    assert got["permission"]["role"] == "viewer"

    # 사본 — yjs_state 복제 확인
    copy = (await app_client.post(f"/api/classroom/boards/{bid}/duplicate", headers=t2)).json()
    assert copy["owner_id"] == teacher2.id and "(사본)" in copy["title"]
    snap = (await app_client.get(
        f"/api/classroom/boards/{copy['id']}/yjs-snapshot",
        headers={"X-Internal-Token": "tok"},
    )).json()
    assert snap["state_base64"] == state


async def test_board_attachment_semester_gating(
    app_client, auth_headers, teacher_user, student_user, db_session, seed_perms,
):
    """보드 첨부 접근은 **활성 학기** 강좌만 — 지난 학기 첨부는 무효."""
    from app.models import Course, CoursePost, CourseStudent, Semester

    t1 = auth_headers(teacher_user)
    s = auth_headers(student_user)
    board = await _create_board(app_client, t1)  # members 모드
    bid = board["id"]

    # 지난 학기 + 강좌 + 수강 + 보드 첨부 글
    past = Semester(year=2025, semester=2, name="2025-2학기",
                    start_date=date(2025, 9, 1), end_date=date(2026, 2, 28),
                    is_current=False)
    cur = Semester(year=2026, semester=1, name="2026-1학기",
                   start_date=date(2026, 3, 1), end_date=date(2026, 8, 31),
                   is_current=True)
    db_session.add_all([past, cur])
    await db_session.flush()
    old_course = Course(semester_id=past.id, teacher_id=teacher_user.id,
                        subject="수학", name="작년 수학")
    db_session.add(old_course)
    await db_session.flush()
    db_session.add(CourseStudent(course_id=old_course.id, student_id=student_user.id, status="active"))
    db_session.add(CoursePost(
        course_id=old_course.id, author_id=teacher_user.id,
        post_type="material", title="작년 보드", content="x",
        attachments=[{"type": "board", "board_id": bid, "title": board["title"]}],
    ))
    await db_session.commit()

    # 지난 학기 첨부 → 접근 불가
    assert (await app_client.get(f"/api/classroom/boards/{bid}", headers=s)).status_code == 403

    # 같은 첨부가 **활성 학기** 강좌에 있으면 접근 OK
    new_course = Course(semester_id=cur.id, teacher_id=teacher_user.id,
                        subject="수학", name="올해 수학")
    db_session.add(new_course)
    await db_session.flush()
    db_session.add(CourseStudent(course_id=new_course.id, student_id=student_user.id, status="active"))
    db_session.add(CoursePost(
        course_id=new_course.id, author_id=teacher_user.id,
        post_type="material", title="올해 보드", content="x",
        attachments=[{"type": "board", "board_id": bid, "title": board["title"]}],
    ))
    await db_session.commit()
    got = (await app_client.get(f"/api/classroom/boards/{bid}", headers=s)).json()
    assert got["permission"]["can_write"] is True


async def test_semester_folder_archive(db_session, teacher_user, seed_perms):
    """학기 전환 시 이전 학기 자동 폴더 → '1. 2026-1학기' 보관 폴더로 이동.

    - 학기 단위 폴더(department)는 항상 이동
    - 학년 단위 폴더(homeroom)는 연도가 바뀔 때만 이동
    - 멱등 (재실행 시 moved=0)
    """
    from datetime import date as _date

    from sqlalchemy import select as _select

    from app.models import Folder, Semester
    from app.services.folder_seed import (
        KIND_SEMESTER_ARCHIVE, archive_semester_folders,
    )

    def mk_sem(year, term):
        return Semester(
            year=year, semester=term, name=f"{year}-{term}",
            start_date=_date(year, 3, 1), end_date=_date(year, 8, 31),
        )
    sem1, sem2, sem3 = mk_sem(2026, 1), mk_sem(2026, 2), mk_sem(2027, 1)
    db_session.add_all([sem1, sem2, sem3])
    await db_session.flush()

    dept = Folder(
        owner_id=teacher_user.id, parent_id=None, name="2026학년도 1학기 수학과",
        auto_kind="department", semester_id=sem1.id,
        source_kind="department", source_id=1, sort_order=1, is_system_locked=True,
    )
    homeroom = Folder(
        owner_id=teacher_user.id, parent_id=None, name="2026학년도 2학년 3반 담임",
        auto_kind="homeroom", semester_id=None,
        source_kind="class", source_id=203, sort_order=2, is_system_locked=True,
    )
    db_session.add_all([dept, homeroom])
    await db_session.flush()

    # 1→2학기 (같은 해): dept만 이동, homeroom은 계속 사용
    res = await archive_semester_folders(db_session, sem1, sem2)
    assert res["moved"] == 1
    archive1 = (await db_session.execute(_select(Folder).where(
        Folder.owner_id == teacher_user.id,
        Folder.auto_kind == KIND_SEMESTER_ARCHIVE,
        Folder.semester_id == sem1.id,
    ))).scalar_one()
    assert archive1.name == "1. 2026-1학기" and archive1.parent_id is None
    assert dept.parent_id == archive1.id
    assert homeroom.parent_id is None

    # 멱등 — 재실행 시 이동 없음
    res2 = await archive_semester_folders(db_session, sem1, sem2)
    assert res2["moved"] == 0

    # 2학기 → 2027-1학기 (연도 전환): homeroom도 보관됨, 번호 2번
    res3 = await archive_semester_folders(db_session, sem2, sem3)
    assert res3["moved"] == 1
    archive2 = (await db_session.execute(_select(Folder).where(
        Folder.owner_id == teacher_user.id,
        Folder.auto_kind == KIND_SEMESTER_ARCHIVE,
        Folder.semester_id == sem2.id,
    ))).scalar_one()
    assert archive2.name == "2. 2026-2학기"
    assert homeroom.parent_id == archive2.id


async def test_drive_integration_trash_restore(
    app_client, auth_headers, teacher_user, seed_perms,
):
    """단어장·보드 드라이브 통합: 목록 노출 → 휴지통 → 도구에서 숨김 → 복구 → 영구삭제."""
    t = auth_headers(teacher_user)
    deck = await _create_deck(app_client, t)
    board = await _create_board(app_client, t)
    did, bid = deck["id"], board["id"]

    # 드라이브 통합 목록에 두 타입 노출
    items = (await app_client.get("/api/drive/items?type=all", headers=t)).json()["items"]
    types = {(i["type"], i["id"]) for i in items}
    assert ("word_decks", did) in types and ("boards", bid) in types

    # 도구에서 삭제 → 휴지통 (soft delete)
    assert (await app_client.delete(f"/api/tools/wordbook/decks/{did}", headers=t)).json()["trashed"] is True
    assert (await app_client.delete(f"/api/classroom/boards/{bid}", headers=t)).json()["trashed"] is True

    # 도구 목록·접근에서 숨김 (404)
    mine = (await app_client.get("/api/tools/wordbook/decks", headers=t)).json()["items"]
    assert all(d["id"] != did for d in mine)
    assert (await app_client.get(f"/api/tools/wordbook/decks/{did}", headers=t)).status_code == 404
    assert (await app_client.get(f"/api/classroom/boards/{bid}", headers=t)).status_code == 404

    # 드라이브 휴지통에 보임
    trash = (await app_client.get("/api/drive/items?trash=true", headers=t)).json()["items"]
    ttypes = {(i["type"], i["id"]) for i in trash}
    assert ("word_decks", did) in ttypes and ("boards", bid) in ttypes

    # 복구 → 도구에서 다시 접근 가능
    assert (await app_client.post(f"/api/drive/items/word_decks/{did}/restore", headers=t)).status_code == 200
    assert (await app_client.post(f"/api/drive/items/boards/{bid}/restore", headers=t)).status_code == 200
    assert (await app_client.get(f"/api/tools/wordbook/decks/{did}", headers=t)).status_code == 200
    assert (await app_client.get(f"/api/classroom/boards/{bid}", headers=t)).status_code == 200

    # 영구 삭제 → DB에서 제거
    await app_client.delete(f"/api/tools/wordbook/decks/{did}", headers=t)
    assert (await app_client.delete(f"/api/drive/items/word_decks/{did}/permanent", headers=t)).status_code == 200
    trash2 = (await app_client.get("/api/drive/items?trash=true", headers=t)).json()["items"]
    assert all(not (i["type"] == "word_decks" and i["id"] == did) for i in trash2)


async def test_drive_copy_word_deck_clones_cards(
    app_client, auth_headers, teacher_user, seed_perms,
):
    """드라이브 Ctrl+C 복사 — 단어장은 카드까지 복제."""
    t = auth_headers(teacher_user)
    deck = await _create_deck(app_client, t)
    did = deck["id"]
    await app_client.post(f"/api/tools/wordbook/decks/{did}/cards",
                          json={"term": "run", "meaning": "달리다"}, headers=t)

    res = await app_client.post(f"/api/drive/items/word_decks/{did}/copy", json={}, headers=t)
    assert res.status_code == 200, res.text
    copy = res.json()
    assert "(복사본)" in copy["title"]
    got = (await app_client.get(f"/api/tools/wordbook/decks/{copy['id']}", headers=t)).json()
    assert len(got["cards"]) == 1 and got["cards"][0]["term"] == "run"


async def test_board_image_upload_and_guard(
    app_client, auth_headers, teacher_user, student_user, seed_perms,
):
    """카드 이미지 업로드(can_write) + files 가드(can_read) — 비멤버 차단."""
    import io as _io

    from PIL import Image

    t = auth_headers(teacher_user)
    s = auth_headers(student_user)
    board = await _create_board(app_client, t)  # members 모드
    bid = board["id"]

    buf = _io.BytesIO()
    Image.new("RGB", (40, 40), (200, 100, 50)).save(buf, format="PNG")
    png = buf.getvalue()

    # 비멤버 학생 업로드 → 403
    res = await app_client.post(
        f"/api/classroom/boards/{bid}/upload-image",
        files={"file": ("a.png", png, "image/png")}, headers=s,
    )
    assert res.status_code == 403

    # 소유자 업로드 → 200 + url
    res = await app_client.post(
        f"/api/classroom/boards/{bid}/upload-image",
        files={"file": ("a.png", png, "image/png")}, headers=t,
    )
    assert res.status_code == 200, res.text
    url = res.json()["url"]
    assert url.startswith("/storage/boards/")

    # files 가드: 소유자 다운로드 OK, 비멤버 403
    api_path = url.replace("/storage/", "/api/files/storage/")
    assert (await app_client.get(api_path, headers=t)).status_code == 200
    assert (await app_client.get(api_path, headers=s)).status_code == 403

    # public 전환 → 학생도 읽기 OK
    await app_client.put(f"/api/classroom/boards/{bid}", json={"access_mode": "public"}, headers=t)
    assert (await app_client.get(api_path, headers=s)).status_code == 200


async def test_board_padlet_settings(app_client, auth_headers, teacher_user, seed_perms):
    """승인/익명/새카드위치/기본정렬 설정 저장·노출."""
    t = auth_headers(teacher_user)
    board = await _create_board(app_client, t)
    bid = board["id"]
    res = await app_client.put(f"/api/classroom/boards/{bid}", json={
        "requires_approval": True, "hide_authors": True,
        "new_card_position": "bottom", "default_sort": "likes",
    }, headers=t)
    assert res.status_code == 200, res.text
    got = (await app_client.get(f"/api/classroom/boards/{bid}", headers=t)).json()
    assert got["requires_approval"] is True and got["hide_authors"] is True
    assert got["new_card_position"] == "bottom" and got["default_sort"] == "likes"


async def test_whiteboard_full_matrix(
    app_client, auth_headers, teacher_user, teacher2, student_user, course, db_session, monkeypatch,
):
    """화이트보드: 접근 매트릭스 + 공유/사본 + 첨부=참여권 + snapshot 토큰 + 드라이브 휴지통."""
    import base64

    from app.core.config import settings as _settings
    from app.models import CoursePost

    t = auth_headers(teacher_user)
    t2 = auth_headers(teacher2)
    s = auth_headers(student_user)

    # 생성 (학생은 manage 권한 없음)
    assert (await app_client.post(
        "/api/classroom/whiteboards", json={"title": "x"}, headers=s,
    )).status_code == 403
    wb = (await app_client.post(
        "/api/classroom/whiteboards", json={"title": "수학 판서", "background": "grid"}, headers=t,
    )).json()
    wid = wb["id"]
    assert wb["background"] == "grid"

    # members + 첨부 없음 → 학생/타교사 403
    assert (await app_client.get(f"/api/classroom/whiteboards/{wid}", headers=s)).status_code == 403
    assert (await app_client.get(f"/api/classroom/whiteboards/{wid}", headers=t2)).status_code == 403

    # 강좌 글 첨부 → 수강생 읽기+쓰기
    db_session.add(CoursePost(
        course_id=course.id, author_id=teacher_user.id,
        post_type="material", title="판서", content="x",
        attachments=[{"type": "whiteboard", "whiteboard_id": wid, "title": "수학 판서"}],
    ))
    await db_session.commit()
    perm = (await app_client.get(f"/api/classroom/whiteboards/{wid}/permission", headers=s)).json()
    assert perm["can_read"] is True and perm["can_write"] is True

    # 공유 → 타교사 열람 전용 + 사본 생성 가능
    await app_client.post(f"/api/classroom/whiteboards/{wid}/shares",
                          json={"user_id": teacher2.id}, headers=t)
    perm2 = (await app_client.get(f"/api/classroom/whiteboards/{wid}/permission", headers=t2)).json()
    assert perm2["can_read"] is True and perm2["can_write"] is False and perm2["role"] == "viewer"
    shared = (await app_client.get("/api/classroom/whiteboards/shared-with-me", headers=t2)).json()["items"]
    assert any(w["id"] == wid for w in shared)
    copy = (await app_client.post(f"/api/classroom/whiteboards/{wid}/duplicate", headers=t2)).json()
    assert copy["owner_id"] == teacher2.id and "(사본)" in copy["title"]

    # yjs-snapshot 내부 토큰 roundtrip
    monkeypatch.setattr(_settings, "HOCUSPOCUS_INTERNAL_TOKEN", "tok", raising=False)
    payload = {"state_base64": base64.b64encode(b"wb-state").decode()}
    assert (await app_client.post(
        f"/api/classroom/whiteboards/{wid}/yjs-snapshot", json=payload,
        headers={"X-Internal-Token": "tok"},
    )).status_code == 200
    got = (await app_client.get(
        f"/api/classroom/whiteboards/{wid}/yjs-snapshot", headers={"X-Internal-Token": "tok"},
    )).json()
    assert got["state_base64"] == payload["state_base64"]

    # 드라이브: 목록 노출 + 휴지통 roundtrip
    items = (await app_client.get("/api/drive/items?type=whiteboards", headers=t)).json()["items"]
    assert any(i["id"] == wid for i in items)
    assert (await app_client.delete(f"/api/classroom/whiteboards/{wid}", headers=t)).json()["trashed"] is True
    assert (await app_client.get(f"/api/classroom/whiteboards/{wid}", headers=t)).status_code == 404
    assert (await app_client.post(f"/api/drive/items/whiteboards/{wid}/restore", headers=t)).status_code == 200
    assert (await app_client.get(f"/api/classroom/whiteboards/{wid}", headers=t)).status_code == 200


async def test_board_layout_and_comment_notify(
    app_client, auth_headers, teacher_user, student_user, course, db_session, seed_perms,
):
    """보드 v2: layout 설정 저장 + 댓글 알림 (첨부 수강생 → 카드 작성자)."""
    from app.models import CoursePost, Notification
    from sqlalchemy import select as _select

    t = auth_headers(teacher_user)
    s = auth_headers(student_user)
    board = await _create_board(app_client, t)
    bid = board["id"]

    # layout 저장
    await app_client.put(f"/api/classroom/boards/{bid}", json={"layout": "canvas"}, headers=t)
    got = (await app_client.get(f"/api/classroom/boards/{bid}", headers=t)).json()
    assert got["layout"] == "canvas"

    # 첨부 후 학생이 교사 카드에 댓글 알림
    db_session.add(CoursePost(
        course_id=course.id, author_id=teacher_user.id,
        post_type="material", title="보드", content="x",
        attachments=[{"type": "board", "board_id": bid, "title": "b"}],
    ))
    await db_session.commit()
    res = await app_client.post(
        f"/api/classroom/boards/{bid}/notify-comment",
        json={"recipient_id": teacher_user.id, "excerpt": "좋은 의견이에요"}, headers=s,
    )
    assert res.status_code == 200 and res.json()["notified"] == 1
    n = (await db_session.execute(_select(Notification).where(
        Notification.user_id == teacher_user.id,
        Notification.type == "board_comment",
    ))).scalars().first()
    assert n is not None and "좋은 의견이에요" in (n.body or "")


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


# ─────────────────────────────────────────────────────────────
# 실시간 투표·워드클라우드 (Mentimeter형)
# ─────────────────────────────────────────────────────────────

async def _create_poll(app_client, auth_headers, teacher_user, *, results_to_students=False):
    """choice(단일) + wordcloud(2단어) 투표 생성 + 세션까지."""
    res = await app_client.post(
        "/api/tools/poll",
        json={
            "title": "수업 만족도",
            "questions": [
                {"type": "choice", "prompt": "오늘 수업 어땠나요?",
                 "options": ["좋았다", "보통", "어려웠다"], "multi": False},
                {"type": "wordcloud", "prompt": "떠오르는 단어는?", "max_words": 2},
            ],
        },
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200, res.text
    poll = res.json()
    res = await app_client.post(
        f"/api/tools/poll/{poll['id']}/sessions",
        json={"settings": {"results_to_students": results_to_students}},
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200, res.text
    return poll, res.json()


async def test_poll_full_flow(
    app_client, auth_headers, teacher_user, student_user, student2, seed_perms, db_session,
):
    """생성 → 입장 → 시작 → choice 응답(중복 409) → goto → wordcloud(한도·중복) → 종료."""
    await db_session.commit()
    t = auth_headers(teacher_user)
    s = auth_headers(student_user)
    s2 = auth_headers(student2)

    poll, sess = await _create_poll(app_client, auth_headers, teacher_user)
    sid = sess["id"]
    qids = [q["id"] for q in poll["questions"]]

    # 학생 입장 (잘못된 PIN 404)
    res = await app_client.post("/api/tools/poll/join", json={"pin": "000000"}, headers=s)
    if sess["pin"] != "000000":
        assert res.status_code == 404
    for h in (s, s2):
        res = await app_client.post("/api/tools/poll/join", json={"pin": sess["pin"]}, headers=h)
        assert res.status_code == 200, res.text

    # lobby 상태에서 응답 409
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[0], "answer": {"selected": ["A"]}}, headers=s,
    )
    assert res.status_code == 409

    # 시작 (학생은 403)
    res = await app_client.post(f"/api/tools/poll/sessions/{sid}/start", headers=s)
    assert res.status_code == 403
    res = await app_client.post(f"/api/tools/poll/sessions/{sid}/start", headers=t)
    assert res.status_code == 200

    # 학생 state — 현재 질문 + 미응답
    st = (await app_client.get(f"/api/tools/poll/play/{sid}/state", headers=s)).json()
    assert st["status"] == "question"
    assert st["question"]["id"] == qids[0]
    assert st["my_responded"] is False
    assert "results" not in st  # results_to_students=False

    # choice 응답 — 잘못된 보기/빈 응답 400, 정상 200, 중복 409
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[0], "answer": {"selected": ["Z"]}}, headers=s,
    )
    assert res.status_code == 400
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[0], "answer": {"selected": ["A"]}}, headers=s,
    )
    assert res.status_code == 200, res.text
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[0], "answer": {"selected": ["B"]}}, headers=s,
    )
    assert res.status_code == 409
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[0], "answer": {"selected": ["B"]}}, headers=s2,
    )
    assert res.status_code == 200

    # 호스트 집계 — A:1, B:1, respondents 2
    hs = (await app_client.get(f"/api/tools/poll/sessions/{sid}", headers=t)).json()
    assert hs["participant_count"] == 2
    assert hs["results"]["counts"] == {"A": 1, "B": 1}
    assert hs["results"]["respondents"] == 2

    # 다음 질문(워드클라우드)으로 — 범위 밖 400
    res = await app_client.post(
        f"/api/tools/poll/sessions/{sid}/goto", json={"index": 9}, headers=t,
    )
    assert res.status_code == 400
    res = await app_client.post(
        f"/api/tools/poll/sessions/{sid}/goto", json={"index": 1}, headers=t,
    )
    assert res.status_code == 200

    # 이전 질문 id로 응답하면 409 (질문 동기화)
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[0], "answer": {"selected": ["A"]}}, headers=s2,
    )
    assert res.status_code == 409

    # 워드클라우드 — 정규화(공백·대문자) 동일 단어 중복 409, max_words=2 한도
    for word, code in [("  재밌다  ", 200), ("재밌다", 409), ("Fun", 200), ("어렵다", 409)]:
        res = await app_client.post(
            f"/api/tools/poll/play/{sid}/respond",
            json={"question_id": qids[1], "answer": {"word": word}}, headers=s,
        )
        assert res.status_code == code, f"{word}: {res.text}"
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[1], "answer": {"word": "fun"}}, headers=s2,
    )
    assert res.status_code == 200

    # 호스트 집계 — fun:2 (대소문자 정규화 합산), 재밌다:1
    hs = (await app_client.get(f"/api/tools/poll/sessions/{sid}", headers=t)).json()
    words = {w["text"]: w["count"] for w in hs["results"]["words"]}
    assert words == {"fun": 2, "재밌다": 1}

    # 종료 → all_results, 학생은 results_to_students=False라 미노출
    res = await app_client.post(f"/api/tools/poll/sessions/{sid}/end", headers=t)
    assert res.status_code == 200
    hs = (await app_client.get(f"/api/tools/poll/sessions/{sid}", headers=t)).json()
    assert len(hs["all_results"]) == 2
    st = (await app_client.get(f"/api/tools/poll/play/{sid}/state", headers=s)).json()
    assert st["status"] == "ended"
    assert "all_results" not in st


async def test_poll_results_to_students_and_idor(
    app_client, auth_headers, teacher_user, teacher2, student_user, seed_perms, db_session,
):
    """results_to_students=True 노출 + 학생/타 교사 가드 + 휴지통·드라이브 통합."""
    await db_session.commit()
    t = auth_headers(teacher_user)
    t2 = auth_headers(teacher2)
    s = auth_headers(student_user)

    # 학생은 투표 생성 403
    res = await app_client.post(
        "/api/tools/poll",
        json={"title": "x", "questions": [
            {"type": "wordcloud", "prompt": "?", "max_words": 1}]},
        headers=s,
    )
    assert res.status_code == 403

    poll, sess = await _create_poll(
        app_client, auth_headers, teacher_user, results_to_students=True,
    )
    sid = sess["id"]
    qids = [q["id"] for q in poll["questions"]]

    # 타 교사 — 남의 투표/세션 접근 403
    res = await app_client.get(f"/api/tools/poll/{poll['id']}", headers=t2)
    assert res.status_code == 403
    res = await app_client.get(f"/api/tools/poll/sessions/{sid}", headers=t2)
    assert res.status_code == 403
    res = await app_client.post(f"/api/tools/poll/sessions/{sid}/end", headers=t2)
    assert res.status_code == 403

    # 미입장 학생 state 403
    res = await app_client.get(f"/api/tools/poll/play/{sid}/state", headers=s)
    assert res.status_code == 403

    await app_client.post("/api/tools/poll/join", json={"pin": sess["pin"]}, headers=s)
    await app_client.post(f"/api/tools/poll/sessions/{sid}/start", headers=t)

    # 응답 → results_to_students=True라 즉시 집계 반환 + state에도 노출
    res = await app_client.post(
        f"/api/tools/poll/play/{sid}/respond",
        json={"question_id": qids[0], "answer": {"selected": ["C"]}}, headers=s,
    )
    assert res.status_code == 200
    assert res.json()["results"]["counts"] == {"C": 1}
    st = (await app_client.get(f"/api/tools/poll/play/{sid}/state", headers=s)).json()
    assert st["results"]["counts"] == {"C": 1}

    # 종료 후 학생도 all_results
    await app_client.post(f"/api/tools/poll/sessions/{sid}/end", headers=t)
    st = (await app_client.get(f"/api/tools/poll/play/{sid}/state", headers=s)).json()
    assert len(st["all_results"]) == 2

    # 삭제 = 드라이브 휴지통 (목록에서 빠지고 trash에 등장, 세션 결과는 보존)
    res = await app_client.delete(f"/api/tools/poll/{poll['id']}", headers=t)
    assert res.status_code == 200
    items = (await app_client.get("/api/tools/poll", headers=t)).json()["items"]
    assert all(p["id"] != poll["id"] for p in items)
    trash = (await app_client.get(
        "/api/drive/items?trash=true", headers=t,
    )).json()
    trash_items = trash["items"] if isinstance(trash, dict) else trash
    assert any(
        it["type"] == "polls" and it["id"] == poll["id"] for it in trash_items
    )
    hs = (await app_client.get(f"/api/tools/poll/sessions/{sid}", headers=t)).json()
    assert len(hs["all_results"]) == 2  # 원본 휴지통 이동과 무관

    # 드라이브 복사 (Ctrl+C) — 질문 구조 복제
    res = await app_client.post(
        f"/api/drive/items/polls/{poll['id']}/copy", headers=t,
    )
    assert res.status_code == 200, res.text
