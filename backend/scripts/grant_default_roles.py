"""권한 매트릭스 합리적 기본값 부여 — 첫 셋업 직후 1회 실행.

시드는 모듈 permissions.py의 `default_roles` 메타를 따르지만,
대부분 모듈이 명시하지 않아서 첫 시드 시 권한이 거의 부여되지 않는다.
이 스크립트는 합리적인 기본 역할별 권한을 일괄 부여한다.

이미 부여된 권한은 건드리지 않는다 (멱등).

실행:
    cd backend
    source venv/bin/activate
    python -m scripts.grant_default_roles

또는 production에서:
    DATABASE_URL='...' python -m scripts.grant_default_roles
"""

import asyncio
import sys
from pathlib import Path

# backend/ 를 path에 추가 (스크립트 단독 실행 위해)
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select
from app.core.database import async_session_factory, init_db
from app.models.permission import Permission, RolePermission


# 교사에게 부여할 권한 — 모든 권한에서 super_admin 전용·관리자 전용 제외
TEACHER_EXCLUDE_PREFIXES = (
    "system.",
    "permission.manage.",
    "chatbot.provider.",
    "chatbot.model.",
    "chatbot.prompt.",
    "chatbot.config.",
    "chatbot.usage.view_all",
)
TEACHER_EXCLUDE_KEYS = {
    "user.manage.create",
    "user.manage.update",
    "user.manage.delete",
    "user.manage.bulk_import",
    "papers.keyword.manage",
}

STAFF_KEYS = {
    "user.manage.view",
    "meeting.view",
    "timetable.view",
    "chatbot.use", "chatbot.session.view_own", "chatbot.session.delete_own",
    "portfolio.artifact.view",
    # 공지사항: 직원도 작성/열람 가능
    "announcement.post.view", "announcement.post.create",
    "announcement.post.edit", "announcement.post.delete",
}

STUDENT_KEYS = {
    "chatbot.use", "chatbot.session.view_own", "chatbot.session.delete_own",
    "contest.participate.view", "contest.participate.submit",
    "assignment.submit.view", "assignment.submit.upload",
    "club.submission.upload", "club.activity.write",
    "community.read", "community.write",
    "challenge.solve",
    "portfolio.career.write_own",
    "admissions.record.view_own",
    "student_self.artifact.upload", "student_self.career.edit",
    # 본인 데이터 조회 (visibility가 본인 sid로 자동 lock)
    "portfolio.grade.view",
    "portfolio.mockexam.view",
    "portfolio.award.view",
    "portfolio.thesis.view",
    "portfolio.counseling.view",
    "portfolio.record.view",
    "portfolio.artifact.view",
    "portfolio.career.view",
    "admissions.record.view",
    "research.project.view",
    # 학생도 공지사항 열람 가능 (라우터에서 audience=all만 노출)
    "announcement.post.view",
}


async def grant_for_role(db, role: str, keys: set[str]) -> int:
    """주어진 role에 keys에 해당하는 permission들을 부여 (이미 있으면 skip)."""
    existing_keys = set(
        (await db.execute(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role == role)
        )).scalars().all()
    )
    added = 0
    for k in keys:
        if k in existing_keys:
            continue
        perm = (await db.execute(
            select(Permission).where(Permission.key == k)
        )).scalar_one_or_none()
        if not perm:
            print(f"  ! 키 없음 (skip): {k}")
            continue
        db.add(RolePermission(role=role, permission_id=perm.id))
        added += 1
    return added


async def main():
    await init_db()
    async with async_session_factory() as db:
        # 1) 전체 권한 조회
        all_keys = set(
            (await db.execute(select(Permission.key))).scalars().all()
        )
        print(f"전체 권한: {len(all_keys)}개")

        # 2) 교사: 거의 모든 권한 (super_admin 전용 제외)
        teacher_keys = {
            k for k in all_keys
            if not k.startswith(TEACHER_EXCLUDE_PREFIXES) and k not in TEACHER_EXCLUDE_KEYS
        }

        teacher_added = await grant_for_role(db, "teacher", teacher_keys)
        staff_added = await grant_for_role(db, "staff", STAFF_KEYS)
        student_added = await grant_for_role(db, "student", STUDENT_KEYS)
        await db.commit()

        print(f"+ teacher 권한 추가: {teacher_added}")
        print(f"+ staff 권한 추가: {staff_added}")
        print(f"+ student 권한 추가: {student_added}")
        print()
        print("완료. 다른 역할(designated_admin)은 super_admin이 권한 매트릭스 페이지에서 조정.")


if __name__ == "__main__":
    asyncio.run(main())
