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


# 교사에게 부여할 권한 — 모든 권한에서 super_admin 전용·관리자 전용 제외.
#
# 보수적 디폴트: 새 권한이 추가돼도 자동 부여되지 않도록 prefix 기반 제외를 우선시.
# 향후 모듈이 늘어나도 admin 전용 prefix만 잘 분리하면 자동 보호.
TEACHER_EXCLUDE_PREFIXES = (
    "system.",              # 시스템 관리 (백업/감사로그/설정/헬스)
    "permission.manage.",   # 권한 매트릭스/그룹 관리
    "user.manage.",         # 사용자 CRUD (단, view는 아래에서 명시 부여)
    "chatbot.provider.",    # LLM API 키
    "chatbot.model.",       # LLM 모델/단가
    "chatbot.prompt.",      # 시스템 프롬프트
    "chatbot.config.",      # 챗봇 기본 설정
)
TEACHER_EXCLUDE_KEYS = {
    "chatbot.usage.view_all",   # 다른 사람 사용량 조회
    "papers.keyword.manage",    # 크롤링 키워드 관리
}

# prefix로 제외됐지만 교사에게 명시적으로 부여할 권한 (예외 화이트리스트).
# user.manage.view는 학생/교직원 명단 조회용으로 교사·직원 모두 필요.
TEACHER_INCLUDE_KEYS = {
    "user.manage.view",
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
    # 클래스룸 조회만 (강좌 관리는 본인 강좌만 — 라우터에서 자동 가드)
    "classroom.course.view", "classroom.post.view",
    # 협업 문서·프리젠테이션: 직원도 강좌 멤버로 부여받을 수 있음
    "classroom.doc.view", "classroom.doc.edit",
    "classroom.deck.view", "classroom.deck.edit",
    # 설문 응답
    "classroom.survey.respond",
    # 드라이브 (개인 자료 + 휴지통)
    "drive.use",
}

STUDENT_KEYS = {
    "chatbot.use", "chatbot.session.view_own", "chatbot.session.delete_own",
    "contest.participate.view", "contest.participate.submit",
    "assignment.submit.view", "assignment.submit.upload",
    "club.submission.upload", "club.activity.write",
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
    # 학생: 본인 수강 강좌 조회 + 클래스룸 글 읽기
    "classroom.course.view", "classroom.post.view",
    # 학생: 협업 문서 조회/편집 (Google Docs 식 동시 편집 — 강좌 멤버 자동 부여)
    "classroom.doc.view", "classroom.doc.edit",
    # 학생: 본인 단독(course_id=null) 문서 생성 — 강좌 안 문서는 라우터에서 교사만 가드
    "classroom.doc.create",
    # 학생: 본인 owner 문서의 멤버·access 변경 (협업 문서 공유 다이얼로그)
    "classroom.doc.share",
    # 학생: 프리젠테이션 view/edit + 본인 단독 생성/공유
    "classroom.deck.view", "classroom.deck.edit",
    "classroom.deck.create", "classroom.deck.share",
    # 학생: 설문 응답 (활성·access_mode 통과 시 가능)
    "classroom.survey.respond",
    # 드라이브 (본인 자료 + 휴지통)
    "drive.use",
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

        # 2) 교사: 거의 모든 권한 (super_admin 전용 제외) + 명시 화이트리스트
        teacher_keys = {
            k for k in all_keys
            if not k.startswith(TEACHER_EXCLUDE_PREFIXES) and k not in TEACHER_EXCLUDE_KEYS
        } | (TEACHER_INCLUDE_KEYS & all_keys)

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
