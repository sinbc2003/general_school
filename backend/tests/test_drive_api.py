"""Drive API 통합 테스트.

검증:
  - GET /api/drive/me: quota·used·만료일
  - GET /api/drive/items: 본인 자료만, 휴지통 필터
  - soft delete / restore / permanent delete: IDOR 가드 + quota 환원
  - 휴지통 비우기 + cron purge_expired_trash
"""

import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select

from app.models import ClassroomDocument, User
from app.modules.drive.router import purge_expired_trash


@pytest.mark.asyncio
async def test_drive_me_returns_quota_for_teacher(app_client, teacher_user, auth_headers):
    r = await app_client.get("/api/drive/me", headers=auth_headers(teacher_user))
    assert r.status_code == 200
    data = r.json()
    assert data["quota_bytes"] > 0
    assert data["used_bytes"] == 0
    assert data["unlimited"] is False
    assert data["user_type"] == "regular"
    assert data["lifecycle_status"] == "active"


@pytest.mark.asyncio
async def test_drive_me_super_admin_unlimited(app_client, super_admin, auth_headers):
    r = await app_client.get("/api/drive/me", headers=auth_headers(super_admin))
    assert r.status_code == 200
    assert r.json()["unlimited"] is True


@pytest.mark.asyncio
async def test_drive_items_returns_only_my_documents(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    # teacher가 owner인 문서
    doc1 = ClassroomDocument(owner_id=teacher_user.id, title="teacher doc")
    # student가 owner인 문서
    doc2 = ClassroomDocument(owner_id=student_user.id, title="student doc")
    db_session.add_all([doc1, doc2])
    await db_session.commit()

    r = await app_client.get("/api/drive/items", headers=auth_headers(teacher_user))
    assert r.status_code == 200
    titles = [it["title"] for it in r.json()["items"]]
    assert "teacher doc" in titles
    assert "student doc" not in titles


@pytest.mark.asyncio
async def test_drive_soft_delete_then_restore(
    app_client, db_session, teacher_user, auth_headers,
):
    doc = ClassroomDocument(owner_id=teacher_user.id, title="del-test")
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    # 휴지통으로 이동
    r = await app_client.delete(
        f"/api/drive/items/docs/{doc.id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # 활성 목록에서 사라짐
    r = await app_client.get("/api/drive/items?trash=false", headers=auth_headers(teacher_user))
    assert all(it["id"] != doc.id for it in r.json()["items"])

    # 휴지통 목록에 나타남
    r = await app_client.get("/api/drive/items?trash=true", headers=auth_headers(teacher_user))
    assert any(it["id"] == doc.id for it in r.json()["items"])

    # 복구
    r = await app_client.post(
        f"/api/drive/items/docs/{doc.id}/restore",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200

    # 다시 활성 목록에 나타남
    r = await app_client.get("/api/drive/items?trash=false", headers=auth_headers(teacher_user))
    assert any(it["id"] == doc.id for it in r.json()["items"])


@pytest.mark.asyncio
async def test_drive_soft_delete_blocks_others_idor(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    doc = ClassroomDocument(owner_id=teacher_user.id, title="protected")
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    # student가 teacher 문서 삭제 시도 → 403
    r = await app_client.delete(
        f"/api/drive/items/docs/{doc.id}",
        headers=auth_headers(student_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_drive_permanent_delete_refunds_quota(
    app_client, db_session, teacher_user, auth_headers,
):
    initial_used = teacher_user.used_bytes or 0
    # storage_bytes를 가진 문서
    doc = ClassroomDocument(owner_id=teacher_user.id, title="big", storage_bytes=5_000_000)
    teacher_user.used_bytes = 5_000_000
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)
    await db_session.refresh(teacher_user)

    # 영구 삭제 (휴지통 거치지 않아도 가능)
    r = await app_client.delete(
        f"/api/drive/items/docs/{doc.id}/permanent",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    assert r.json()["freed_bytes"] == 5_000_000

    # quota 환원 확인
    await db_session.refresh(teacher_user)
    assert teacher_user.used_bytes == initial_used


@pytest.mark.asyncio
async def test_drive_trash_empty_clears_all_trashed(
    app_client, db_session, teacher_user, auth_headers,
):
    now = datetime.now(timezone.utc)
    # 3개 문서 모두 휴지통
    for i in range(3):
        d = ClassroomDocument(
            owner_id=teacher_user.id, title=f"trash-{i}",
            storage_bytes=1_000_000, deleted_at=now,
        )
        db_session.add(d)
    teacher_user.used_bytes = 3_000_000
    await db_session.commit()

    r = await app_client.post("/api/drive/trash/empty", headers=auth_headers(teacher_user))
    assert r.status_code == 200
    assert r.json()["deleted_count"] == 3
    assert r.json()["freed_bytes"] == 3_000_000

    # 휴지통 비어있음
    r = await app_client.get("/api/drive/items?trash=true", headers=auth_headers(teacher_user))
    assert len(r.json()["items"]) == 0


@pytest.mark.asyncio
async def test_purge_expired_trash_30_day_cutoff(db_session, teacher_user):
    """30일 경과한 휴지통 자료는 자동 hard delete."""
    long_ago = datetime.now(timezone.utc) - timedelta(days=31)
    recent = datetime.now(timezone.utc) - timedelta(days=10)

    old_doc = ClassroomDocument(
        owner_id=teacher_user.id, title="old", storage_bytes=1_000_000,
        deleted_at=long_ago,
    )
    new_doc = ClassroomDocument(
        owner_id=teacher_user.id, title="new", storage_bytes=1_000_000,
        deleted_at=recent,
    )
    teacher_user.used_bytes = 2_000_000
    db_session.add_all([old_doc, new_doc])
    await db_session.commit()

    result = await purge_expired_trash(db_session)
    await db_session.commit()

    # 30일 지난 것만 hard delete
    assert result["deleted_total"] == 1
    assert result["freed_bytes_total"] == 1_000_000

    # new_doc은 여전히 존재
    remaining = (await db_session.execute(
        select(ClassroomDocument).where(ClassroomDocument.owner_id == teacher_user.id)
    )).scalars().all()
    assert len(remaining) == 1
    assert remaining[0].title == "new"
