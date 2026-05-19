"""검증용 더미 학생 계정 생성 + 강좌·문서 자동 등록.

사용:
    cd backend && source venv/bin/activate
    python -m scripts.seed_dummy_student [count=3] [doc_id]

동작:
1. 학생 count명 생성: student1/11111111, student2/22222222, ...
   이미 있으면 skip (멱등). bcrypt hash.
2. doc_id 지정 시: 해당 문서의 course_id를 찾아, 그 강좌에 학생 모두 active로 등록.
   doc_id 미지정: 가장 최근 ClassroomDocument의 course_id 사용.
3. 학생은 이메일 2FA 면제 (즉시 token 발급) — 로그인 빠름.

검증 절차:
- super_admin 본인 + 학생1/11111111 → 두 다른 계정으로 같은 문서 접속
- 각자 다른 awareness 색깔 → 진짜 협업 시각화 확인

정리:
    DELETE FROM users WHERE username LIKE 'student%' AND role='student';
"""

import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import desc, select

from app.core.auth import hash_password
from app.core.database import async_session_factory, init_db
from app.models.classroom import CourseStudent
from app.models.classroom_docs import ClassroomDocument
from app.models.user import User


async def main(count: int = 3, doc_id: int | None = None) -> None:
    await init_db()
    async with async_session_factory() as db:
        # 1) 학생 생성 (멱등)
        created_ids: list[int] = []
        for i in range(1, count + 1):
            username = f"student{i}"
            existing = (await db.execute(
                select(User).where(User.username == username)
            )).scalar_one_or_none()
            if existing:
                print(f"= {username} 이미 존재 (id={existing.id}) — skip 생성")
                created_ids.append(existing.id)
                continue
            password = str(i) * 8  # 11111111, 22222222, 33333333, ...
            student = User(
                email=f"{username}@test.local",
                username=username,
                name=f"더미학생{i}",
                role="student",
                status="approved",
                password_hash=hash_password(password),
                grade=1, class_number=1, student_number=i,
                must_change_password=False,
            )
            db.add(student)
            await db.flush()
            print(f"+ {username} / {password} 생성 (id={student.id})")
            created_ids.append(student.id)

        # 2) 강좌 등록
        target_doc: ClassroomDocument | None
        if doc_id:
            target_doc = await db.get(ClassroomDocument, doc_id)
        else:
            target_doc = (await db.execute(
                select(ClassroomDocument).order_by(desc(ClassroomDocument.id)).limit(1)
            )).scalar_one_or_none()

        if not target_doc:
            print("! ClassroomDocument 없음 — 강좌 등록 skip")
        elif not target_doc.course_id:
            print(f"! doc {target_doc.id}는 단독 문서 (course_id=None) — 강좌 등록 skip")
        else:
            course_id = target_doc.course_id
            print(f"  target doc={target_doc.id} → course_id={course_id}")
            for sid in created_ids:
                dup = (await db.execute(
                    select(CourseStudent).where(
                        CourseStudent.course_id == course_id,
                        CourseStudent.student_id == sid,
                    )
                )).scalar_one_or_none()
                if dup:
                    if dup.status != "active":
                        dup.status = "active"
                        print(f"  ~ student id={sid} 재활성화")
                    else:
                        print(f"  = student id={sid} 이미 등록됨 — skip")
                else:
                    db.add(CourseStudent(
                        course_id=course_id, student_id=sid, status="active",
                    ))
                    print(f"  + student id={sid} → course {course_id} 등록")

        await db.commit()
        print()
        print(f"총 {len(created_ids)}명 계정 활성. 로그인 예시:")
        for i, sid in enumerate(created_ids, 1):
            print(f"  student{i} / {str(i) * 8}")


if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    doc_id = int(sys.argv[2]) if len(sys.argv) > 2 else None
    asyncio.run(main(count=count, doc_id=doc_id))
