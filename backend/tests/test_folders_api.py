"""폴더 시스템 통합 테스트.

검증:
  - 폴더 CRUD (생성/조회/이름변경/삭제)
  - 다단계 중첩 + cycle 방지
  - 잠금 폴더 (is_system_locked) 이름변경·이동·삭제 차단
  - 자료 폴더 이동 (move)
  - 자료 복사 (copy) — docs/sheets/decks 지원, hwps/surveys 거부
  - 자동 폴더 동기화 (folder_seed)
  - 다른 사용자 폴더 접근 차단 (IDOR)
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import (
    ClassroomDocument, ClassroomHwp, ClassroomPresentation,
    ClassroomSheet, Folder, User,
)


@pytest.mark.security
@pytest.mark.asyncio
async def test_create_manual_folder(app_client, teacher_user, auth_headers):
    r = await app_client.post(
        "/api/drive/folders",
        json={"name": "내 자료", "parent_id": None},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "내 자료"
    assert data["is_system_locked"] is False
    assert data["parent_id"] is None
    assert data["owner_id"] == teacher_user.id


@pytest.mark.security
@pytest.mark.asyncio
async def test_create_nested_folder(app_client, teacher_user, auth_headers):
    r1 = await app_client.post(
        "/api/drive/folders",
        json={"name": "부모"},
        headers=auth_headers(teacher_user),
    )
    parent_id = r1.json()["id"]
    r2 = await app_client.post(
        "/api/drive/folders",
        json={"name": "자식", "parent_id": parent_id},
        headers=auth_headers(teacher_user),
    )
    assert r2.status_code == 200
    assert r2.json()["parent_id"] == parent_id


@pytest.mark.security
@pytest.mark.asyncio
async def test_idor_cannot_access_other_user_folder(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """다른 사용자 폴더에 접근/수정/삭제 시 403/404."""
    other = Folder(
        owner_id=teacher_user.id, name="비공개", parent_id=None,
        sort_order=1, is_system_locked=False,
    )
    db_session.add(other)
    await db_session.commit()

    # 학생이 교사 폴더 조회 시도
    r = await app_client.get(
        f"/api/drive/folders/{other.id}",
        headers=auth_headers(student_user),
    )
    assert r.status_code in (403, 404)

    # 학생이 교사 폴더 이름변경 시도
    r = await app_client.patch(
        f"/api/drive/folders/{other.id}",
        json={"name": "해킹시도"},
        headers=auth_headers(student_user),
    )
    assert r.status_code in (403, 404)

    # 학생이 교사 폴더 삭제 시도
    r = await app_client.delete(
        f"/api/drive/folders/{other.id}",
        headers=auth_headers(student_user),
    )
    assert r.status_code in (403, 404)


@pytest.mark.security
@pytest.mark.asyncio
async def test_locked_folder_cannot_be_renamed_or_deleted(
    app_client, db_session, teacher_user, auth_headers,
):
    locked = Folder(
        owner_id=teacher_user.id, name="잠금폴더", parent_id=None,
        sort_order=1, is_system_locked=True,
        auto_kind="department", semester_id=None,
        source_kind="department", source_id=1,
    )
    db_session.add(locked)
    await db_session.commit()

    r = await app_client.patch(
        f"/api/drive/folders/{locked.id}",
        json={"name": "변경시도"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 409

    r = await app_client.delete(
        f"/api/drive/folders/{locked.id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_cycle_prevention_in_folder_move(
    app_client, teacher_user, auth_headers,
):
    """자식 폴더로 부모를 옮기면 400."""
    r1 = await app_client.post(
        "/api/drive/folders",
        json={"name": "A"},
        headers=auth_headers(teacher_user),
    )
    a_id = r1.json()["id"]
    r2 = await app_client.post(
        "/api/drive/folders",
        json={"name": "B", "parent_id": a_id},
        headers=auth_headers(teacher_user),
    )
    b_id = r2.json()["id"]

    # A를 B의 자식으로 옮기려고 시도 → 400 (B가 A의 자손이므로)
    r = await app_client.patch(
        f"/api/drive/folders/{a_id}",
        json={"parent_id": b_id},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 400

    # A를 자기 자신의 자식으로 → 400
    r = await app_client.patch(
        f"/api/drive/folders/{a_id}",
        json={"parent_id": a_id},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 400


@pytest.mark.security
@pytest.mark.asyncio
async def test_move_item_to_folder(
    app_client, db_session, teacher_user, auth_headers,
):
    doc = ClassroomDocument(owner_id=teacher_user.id, title="이동 대상")
    db_session.add(doc)
    folder = Folder(
        owner_id=teacher_user.id, name="대상폴더", sort_order=1,
        is_system_locked=False,
    )
    db_session.add(folder)
    await db_session.commit()

    r = await app_client.post(
        f"/api/drive/items/docs/{doc.id}/move",
        json={"folder_id": folder.id},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    await db_session.refresh(doc)
    assert doc.folder_id == folder.id

    # 다시 루트로
    r = await app_client.post(
        f"/api/drive/items/docs/{doc.id}/move",
        json={"folder_id": None},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    await db_session.refresh(doc)
    assert doc.folder_id is None


@pytest.mark.security
@pytest.mark.asyncio
async def test_move_other_user_item_blocked(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    doc = ClassroomDocument(owner_id=teacher_user.id, title="남의 문서")
    db_session.add(doc)
    folder = Folder(
        owner_id=student_user.id, name="학생 폴더", sort_order=1,
        is_system_locked=False,
    )
    db_session.add(folder)
    await db_session.commit()

    # 학생이 교사 문서를 자기 폴더로 이동 시도 → 403
    r = await app_client.post(
        f"/api/drive/items/docs/{doc.id}/move",
        json={"folder_id": folder.id},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_copy_doc_creates_clone(
    app_client, db_session, teacher_user, auth_headers,
):
    src = ClassroomDocument(
        owner_id=teacher_user.id, title="원본",
        plain_text="본문 내용", storage_bytes=100,
    )
    db_session.add(src)
    await db_session.commit()
    src_id = src.id

    r = await app_client.post(
        f"/api/drive/items/docs/{src.id}/copy",
        json={"folder_id": None},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["title"] == "원본 (복사본)"
    assert data["id"] != src_id

    # 사용자 quota 증가했는지
    await db_session.refresh(teacher_user)
    assert teacher_user.used_bytes >= 100


@pytest.mark.asyncio
async def test_copy_hwps_ok_without_file(
    app_client, db_session, teacher_user, auth_headers,
):
    """file_path 없는 HWP도 메타만 복사 OK (실 파일 없음)."""
    h = ClassroomHwp(owner_id=teacher_user.id, title="빈 hwp")
    db_session.add(h)
    await db_session.commit()
    r = await app_client.post(
        f"/api/drive/items/hwps/{h.id}/copy",
        json={"folder_id": None},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    assert r.json()["title"] == "빈 hwp (복사본)"


@pytest.mark.asyncio
async def test_copy_surveys_rejected(
    app_client, db_session, teacher_user, auth_headers,
):
    """설문지는 질문/응답 복잡으로 미지원."""
    from app.models import Survey
    s = Survey(author_id=teacher_user.id, title="설문")
    db_session.add(s)
    await db_session.commit()
    r = await app_client.post(
        f"/api/drive/items/surveys/{s.id}/copy",
        json={"folder_id": None},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 400


@pytest.mark.security
@pytest.mark.asyncio
async def test_copy_other_user_item_blocked(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    src = ClassroomDocument(owner_id=teacher_user.id, title="남의 문서")
    db_session.add(src)
    await db_session.commit()

    r = await app_client.post(
        f"/api/drive/items/docs/{src.id}/copy",
        json={"folder_id": None},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 403


@pytest.mark.security
@pytest.mark.asyncio
async def test_batch_organize_returns_undo_log_and_can_undo(
    app_client, db_session, teacher_user, auth_headers,
):
    """batch_organize 응답에 undo_log 포함 + undo로 복원 가능."""
    from app.models import ClassroomDocument
    doc = ClassroomDocument(owner_id=teacher_user.id, title="원본 제목")
    db_session.add(doc)
    await db_session.commit()
    doc_id = doc.id

    # 정리: 새 폴더 + 자료 이름변경 + 이동
    r1 = await app_client.post(
        "/api/drive/items/_batch-organize",
        json={
            "actions": [
                {"action": "create_folder", "folder_name": "정리함", "temp_id": "F1"},
                {
                    "action": "rename_and_move",
                    "item_type": "docs", "item_id": doc_id,
                    "new_title": "01. 정리된 제목",
                    "target_temp_id": "F1",
                },
            ],
        },
        headers=auth_headers(teacher_user),
    )
    assert r1.status_code == 200, r1.text
    data = r1.json()
    assert "undo_log" in data
    assert len(data["undo_log"]) >= 2

    # 자료 변경 확인
    await db_session.refresh(doc)
    assert doc.title == "01. 정리된 제목"
    assert doc.folder_id is not None

    # undo
    r2 = await app_client.post(
        "/api/drive/items/_undo-organize",
        json={"undo_log": data["undo_log"]},
        headers=auth_headers(teacher_user),
    )
    assert r2.status_code == 200, r2.text
    u = r2.json()
    assert u["renamed"] >= 1
    assert u["moved"] >= 1
    assert u["folders_deleted"] >= 1

    # 자료 원상복구
    await db_session.refresh(doc)
    assert doc.title == "원본 제목"
    assert doc.folder_id is None


@pytest.mark.security
@pytest.mark.asyncio
async def test_undo_organize_only_owns_items(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """다른 사용자 자료를 undo_log에 끼워도 cross-user 변경 차단."""
    from app.models import ClassroomDocument
    other_doc = ClassroomDocument(owner_id=teacher_user.id, title="교사 문서")
    db_session.add(other_doc)
    await db_session.commit()

    # 학생이 가짜 undo_log 보내서 교사 자료 복원 시도
    fake_undo = [
        {"undo": "rename", "item_type": "docs", "item_id": other_doc.id,
         "prev_title": "해킹된 제목"},
    ]
    r = await app_client.post(
        "/api/drive/items/_undo-organize",
        json={"undo_log": fake_undo},
        headers=auth_headers(student_user),
    )
    # 200이지만 renamed=0 (cross-user skip)
    assert r.status_code == 200
    assert r.json()["renamed"] == 0
    # 자료 제목 안 바뀜
    await db_session.refresh(other_doc)
    assert other_doc.title == "교사 문서"


@pytest.mark.asyncio
async def test_delete_folder_with_children_rejected(
    app_client, teacher_user, auth_headers,
):
    r1 = await app_client.post(
        "/api/drive/folders",
        json={"name": "부모"},
        headers=auth_headers(teacher_user),
    )
    parent_id = r1.json()["id"]
    await app_client.post(
        "/api/drive/folders",
        json={"name": "자식", "parent_id": parent_id},
        headers=auth_headers(teacher_user),
    )

    r = await app_client.delete(
        f"/api/drive/folders/{parent_id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 400  # 자식 있으면 삭제 거부
