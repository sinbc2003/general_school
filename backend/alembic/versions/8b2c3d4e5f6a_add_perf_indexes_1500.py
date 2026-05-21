"""add performance indexes for 1500 users

Revision ID: 8b2c3d4e5f6a
Revises: 7a1b2c3d4e5f
Create Date: 2026-05-22 22:00:00.000000

1500명 운영 대비 hot path 인덱스 추가:
- course_students (student_id, status): 학생 active 강좌 JOIN
- classroom_docs/sheets/decks/surveys/hwps (owner_id, deleted_at): 드라이브 list 활성 필터
- classroom_doc_revisions (document_id, created_at DESC): revision cleanup
- semester_enrollments (semester_id, role, status): 학기 명단 조회

멱등 — 인덱스 이미 있으면 skip.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8b2c3d4e5f6a"
down_revision: Union[str, Sequence[str], None] = "7a1b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_exists(bind, table: str, name: str) -> bool:
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    return any(idx["name"] == name for idx in insp.get_indexes(table))


_NEW_INDEXES = [
    # 학생 active 강좌 list — 가장 자주 호출 (드라이브, classroom, enrollment)
    ("course_students", "ix_course_students_student_status", ["student_id", "status"]),
    # 드라이브 active 자료 조회 (5개 자료 공통 패턴)
    ("classroom_docs", "ix_classroom_docs_owner_deleted", ["owner_id", "deleted_at"]),
    ("classroom_sheets", "ix_classroom_sheets_owner_deleted", ["owner_id", "deleted_at"]),
    ("classroom_presentations", "ix_classroom_presentations_owner_deleted", ["owner_id", "deleted_at"]),
    ("classroom_surveys", "ix_classroom_surveys_author_deleted", ["author_id", "deleted_at"]),
    ("classroom_hwps", "ix_classroom_hwps_owner_deleted", ["owner_id", "deleted_at"]),
    # 학기 명단 조회 (관리자 list 페이지)
    ("semester_enrollments", "ix_semester_enrollments_sem_role_status",
     ["semester_id", "role", "status"]),
    # 강좌 list (semester + active)
    ("classroom_courses", "ix_classroom_courses_sem_active",
     ["semester_id", "is_active"]),
    # 문서 revision 정리 (시간 순)
    ("classroom_doc_revisions", "ix_classroom_doc_revisions_doc_created",
     ["document_id", "created_at"]),
    # folder_id로 자료 필터 (drive folder 안 조회)
    ("classroom_docs", "ix_classroom_docs_owner_folder",
     ["owner_id", "folder_id"]),
    ("classroom_sheets", "ix_classroom_sheets_owner_folder",
     ["owner_id", "folder_id"]),
    ("classroom_presentations", "ix_classroom_presentations_owner_folder",
     ["owner_id", "folder_id"]),
    ("classroom_surveys", "ix_classroom_surveys_author_folder",
     ["author_id", "folder_id"]),
    ("classroom_hwps", "ix_classroom_hwps_owner_folder",
     ["owner_id", "folder_id"]),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_tables = set(insp.get_table_names())
    dialect = bind.dialect.name  # 'postgresql' or 'sqlite'
    for table, name, cols in _NEW_INDEXES:
        if table not in existing_tables:
            continue
        # 컬럼 존재 확인 (멱등)
        col_names = {c["name"] for c in insp.get_columns(table)}
        if not all(c in col_names for c in cols):
            continue
        if dialect == "postgresql":
            cols_sql = ", ".join(cols)
            op.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({cols_sql})')
        else:
            # SQLite — 인덱스 이미 있으면 skip
            if not _index_exists(bind, table, name):
                op.create_index(name, table, cols)


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    for table, name, _ in _NEW_INDEXES:
        if dialect == "postgresql":
            op.execute(f'DROP INDEX IF EXISTS "{name}"')
        else:
            if _index_exists(bind, table, name):
                op.drop_index(name, table_name=table)
