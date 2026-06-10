"""글 첨부 share_mode 기반 자료 접근 — Google Classroom '파일 공유 옵션'.

교사가 개인 드라이브 자료(doc/sheet/deck/hwp)를 강좌 글에 첨부하면서
share_mode를 지정하면, 그 강좌 멤버(active 수강생 + 강좌 교사/공동교사)에게:

  - view → 읽기
  - edit → 읽기 + 쓰기 (공동 편집)
  - copy → 여기서는 권한 없음 (student_copy.py의 학생별 사본 흐름이 별도 처리;
           원본 직접 접근은 불필요하므로 부여하지 않음)

각 자료 모듈(classroom_docs/sheets/slides/hwps)의 resolve_permission이
기존 분기(owner/admin/course_members/specific_users)에서 접근을 못 찾았을 때
additive fallback으로만 호출한다 — 기존 접근을 절대 축소하지 않는다.
"""

from sqlalchemy import Text, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.classroom import Course, CoursePost, CourseStudent
from app.models.course_teacher import CourseTeacher
from app.models.user import User

# attachment type → JSON 안의 id 키
_ATT_ID_KEYS = {
    "doc": "doc_id",
    "sheet": "sheet_id",
    "deck": "deck_id",
    "hwp": "hwp_id",
}


async def attachment_share_access(
    db: AsyncSession, user: User, att_type: str, resource_id: int,
) -> str | None:
    """이 자료가 사용자 소속 강좌의 글에 share_mode=view/edit로 첨부됐는지 검사.

    returns: "edit" | "view" | None (여러 글에 첨부됐으면 가장 넓은 권한)
    """
    id_key = _ATT_ID_KEYS.get(att_type)
    if not id_key:
        return None

    # 사용자가 멤버인 강좌 — active 수강생 OR 강좌 owner OR 공동교사
    student_ids = (await db.execute(
        select(CourseStudent.course_id).where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalars().all()
    owner_ids = (await db.execute(
        select(Course.id).where(Course.teacher_id == user.id)
    )).scalars().all()
    co_ids = (await db.execute(
        select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
    )).scalars().all()
    course_ids = set(student_ids) | set(owner_ids) | set(co_ids)
    if not course_ids:
        return None

    # JSON→text LIKE는 키 존재 prefilter일 뿐 — 실제 매칭은 Python에서 (직렬화 공백 무관)
    rows = (await db.execute(
        select(CoursePost.attachments).where(
            CoursePost.course_id.in_(course_ids),
            CoursePost.attachments.isnot(None),
            cast(CoursePost.attachments, Text).like(f'%"{id_key}"%'),
        )
    )).scalars().all()

    best: str | None = None
    for atts in rows:
        if not isinstance(atts, list):
            continue
        for a in atts:
            if not isinstance(a, dict):
                continue
            if a.get("type") != att_type or a.get(id_key) != resource_id:
                continue
            mode = a.get("share_mode") or "view"
            if mode == "edit":
                return "edit"
            if mode == "view":
                best = "view"
            # copy는 권한 부여 안 함 (학생별 사본 흐름 별도)
    return best
