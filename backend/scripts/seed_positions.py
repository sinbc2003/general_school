"""시스템 기본 직책 템플릿 시드 — 학교 일반 직책 예시.

학교가 자유 정의 가능하지만, 첫 셋업 직후 운영을 빠르게 시작할 수 있도록
일반 학교에서 흔한 직책 몇 가지를 미리 등록한다.

- is_system=True로 등록되어 관리자가 삭제할 수 없음 (수정·권한 키 변경은 가능).
- 기존에 같은 key가 있으면 건드리지 않음 (멱등 — 학교가 권한을 조정해도 보존).
- 새 권한 키가 모듈에서 추가되면 관리자가 매트릭스에서 추가하거나 이 시드를
  수정 후 backend 재시작.

학교마다 운영 양상이 다르므로 권한 키는 보수적으로 설정 (필요 시 학교가 추가).
"""

import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.position import PositionTemplate


# (key, display_name, category, description, permission_keys)
DEFAULT_TEMPLATES: list[tuple[str, str, str, str, list[str]]] = [
    (
        "homeroom_teacher",
        "담임교사",
        "학급",
        "담임 업무 — 학생 포트폴리오·생기부 작성·상담 권한.",
        [
            "portfolio.record.write",
            "portfolio.counseling.write",
            "portfolio.career.view",
            "assignment.manage.create",
            "assignment.manage.review",
        ],
    ),
    (
        "subhomeroom_teacher",
        "부담임교사",
        "학급",
        "부담임 업무 — 담임 부재 시 보조. 조회 위주.",
        [
            "portfolio.record.view",
            "portfolio.counseling.view",
        ],
    ),
    (
        "club_advisor",
        "동아리 담당교사",
        "동아리",
        "동아리 운영·산출물 검토.",
        [
            "club.manage.create",
            "club.manage.edit",
            "club.submission.review",
        ],
    ),
    (
        "career_counselor",
        "진로진학 담당",
        "진로",
        "진로진학·대입 데이터 관리.",
        [
            "admissions.record.write",
            "admissions.record.view",
            "portfolio.career.view",
        ],
    ),
    (
        "research_advisor",
        "연구지도교사",
        "연구",
        "학생 연구 프로젝트 지도 + 산출물 검토.",
        [
            "research.project.create",
            "research.project.review",
        ],
    ),
    (
        "contest_manager",
        "대회 담당",
        "대회",
        "교내 대회 출제·운영.",
        [
            "contest.manage.create",
            "contest.manage.edit",
            "problem.library.write",
        ],
    ),
    (
        "info_lead",
        "정보 부장",
        "부장",
        "시간표·자료실 편집·시스템 운영 보조.",
        [
            "timetable.edit",
            "archive.document.upload",
            "archive.problem.upload",
        ],
    ),
]


async def seed_default_position_templates(db: AsyncSession) -> None:
    """기본 직책 템플릿 시드. 멱등."""
    # 권한 키 유효성 확인 — 존재하지 않는 키는 시드 시점에 자동 제거
    from app.models.permission import Permission
    all_perm_keys = set(
        (await db.execute(select(Permission.key))).scalars().all()
    )

    existing_keys = set(
        (await db.execute(select(PositionTemplate.key))).scalars().all()
    )

    added = 0
    for key, display_name, category, description, perm_keys in DEFAULT_TEMPLATES:
        if key in existing_keys:
            continue
        # 권한 키 필터링 — 현재 backend에 정의되지 않은 키는 자동 제거
        valid_keys = [k for k in perm_keys if k in all_perm_keys]
        db.add(PositionTemplate(
            key=key,
            display_name=display_name,
            category=category,
            description=description,
            permission_keys=json.dumps(valid_keys, ensure_ascii=False),
            is_system=True,
        ))
        added += 1

    if added:
        await db.flush()
        print(f"[SEED] 기본 직책 템플릿 {added}개 추가")
