"""add_quota_department_course_teachers_soft_delete

Phase 1.0-A: 드라이브/Quota + 인사이동 + 부서 + 공동교사 + 강좌 커스터마이징 + 휴지통(soft delete).

신규 테이블:
  - departments (학교 부서 단위)
  - classroom_course_teachers (공동교사 M2M)
  - user_favorite_courses (즐겨찾기 강좌 M2M)

users 확장:
  - 인사 상태: lifecycle_status, user_type, expires_at
  - 부서/학년부장: department_id, is_grade_lead, lead_grade
  - 드라이브: quota_bytes, used_bytes
  - 외부 연동: google_email

classroom_courses 확장:
  - 강좌 타입: course_type, grade_level
  - 카드 디자인: banner_color, banner_image_url, icon
  - 열람 권한: viewable_by

협업 도구 (docs/sheets/slides/surveys) soft delete:
  - deleted_at, deleted_by, storage_bytes (휴지통 30일 복구 + quota 정확한 환원)

Revision ID: d6aa2049798f
Revises: 57f818d2105d
Create Date: 2026-05-20 15:48:05.263247

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6aa2049798f'
down_revision: Union[str, Sequence[str], None] = '57f818d2105d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 역할별 기본 quota (MB → bytes). super_admin은 0 = 무제한.
DEFAULT_QUOTA_SQL = """
UPDATE users SET quota_bytes = CASE
  WHEN role = 'super_admin' THEN 0
  WHEN role = 'designated_admin' THEN 1000 * 1024 * 1024
  WHEN role = 'teacher' THEN 500 * 1024 * 1024
  WHEN role = 'staff' THEN 300 * 1024 * 1024
  WHEN role = 'student' THEN 200 * 1024 * 1024
  ELSE 200 * 1024 * 1024
END
WHERE quota_bytes = 0
"""


def upgrade() -> None:
    """Upgrade schema."""
    # ── 1. 새 테이블: departments ──
    op.create_table(
        'departments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('lead_user_id', sa.Integer(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_index(op.f('ix_departments_lead_user_id'), 'departments', ['lead_user_id'], unique=False)

    # ── 2. 새 테이블: classroom_course_teachers (공동교사 M2M) ──
    op.create_table(
        'classroom_course_teachers',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False, server_default='co_teacher'),
        sa.Column('added_by', sa.Integer(), nullable=True),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['added_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['course_id'], ['classroom_courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_id', 'user_id', name='uq_course_teacher'),
    )
    op.create_index('ix_course_teachers_course_id', 'classroom_course_teachers', ['course_id'], unique=False)
    op.create_index('ix_course_teachers_user_id', 'classroom_course_teachers', ['user_id'], unique=False)

    # ── 3. 새 테이블: user_favorite_courses ──
    op.create_table(
        'user_favorite_courses',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['classroom_courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'course_id', name='uq_user_favorite_course'),
    )
    op.create_index('ix_user_favorite_courses_user_id', 'user_favorite_courses', ['user_id'], unique=False)

    # ── 4. users 확장 ──
    op.add_column('users', sa.Column('lifecycle_status', sa.String(length=20), nullable=False, server_default='active'))
    op.add_column('users', sa.Column('user_type', sa.String(length=20), nullable=False, server_default='regular'))
    op.add_column('users', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('department_id', sa.Integer(), nullable=True))
    op.add_column('users', sa.Column('is_grade_lead', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('users', sa.Column('lead_grade', sa.Integer(), nullable=True))
    op.add_column('users', sa.Column('quota_bytes', sa.BigInteger(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('used_bytes', sa.BigInteger(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('google_email', sa.String(length=255), nullable=True))
    op.create_index(op.f('ix_users_department_id'), 'users', ['department_id'], unique=False)
    op.create_index(op.f('ix_users_lifecycle_status'), 'users', ['lifecycle_status'], unique=False)
    op.create_index(op.f('ix_users_user_type'), 'users', ['user_type'], unique=False)
    op.create_foreign_key('fk_users_department_id', 'users', 'departments', ['department_id'], ['id'], ondelete='SET NULL')

    # 기존 사용자에게 역할별 기본 quota 부여
    op.execute(DEFAULT_QUOTA_SQL)

    # ── 5. classroom_courses 확장 ──
    op.add_column('classroom_courses', sa.Column('course_type', sa.String(length=30), nullable=False, server_default='subject'))
    op.add_column('classroom_courses', sa.Column('grade_level', sa.Integer(), nullable=True))
    op.add_column('classroom_courses', sa.Column('banner_color', sa.String(length=20), nullable=False, server_default='#7986CB'))
    op.add_column('classroom_courses', sa.Column('banner_image_url', sa.String(length=500), nullable=True))
    op.add_column('classroom_courses', sa.Column('icon', sa.String(length=50), nullable=True))
    op.add_column('classroom_courses', sa.Column('viewable_by', sa.String(length=30), nullable=False, server_default='all_teachers'))
    op.create_index(op.f('ix_classroom_courses_course_type'), 'classroom_courses', ['course_type'], unique=False)

    # ── 6. 협업 도구 soft delete + storage_bytes ──
    for table in ('classroom_docs', 'classroom_presentations', 'classroom_sheets', 'classroom_surveys'):
        op.add_column(table, sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
        op.add_column(table, sa.Column('deleted_by', sa.Integer(), nullable=True))
        op.add_column(table, sa.Column('storage_bytes', sa.Integer(), nullable=False, server_default='0'))
        op.create_index(op.f(f'ix_{table}_deleted_at'), table, ['deleted_at'], unique=False)
        op.create_foreign_key(f'fk_{table}_deleted_by', table, 'users', ['deleted_by'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema — 역방향 (개발용 안전망)."""
    # 협업 도구 soft delete 제거
    for table in ('classroom_surveys', 'classroom_sheets', 'classroom_presentations', 'classroom_docs'):
        op.drop_constraint(f'fk_{table}_deleted_by', table, type_='foreignkey')
        op.drop_index(op.f(f'ix_{table}_deleted_at'), table_name=table)
        op.drop_column(table, 'storage_bytes')
        op.drop_column(table, 'deleted_by')
        op.drop_column(table, 'deleted_at')

    # classroom_courses 확장 제거
    op.drop_index(op.f('ix_classroom_courses_course_type'), table_name='classroom_courses')
    op.drop_column('classroom_courses', 'viewable_by')
    op.drop_column('classroom_courses', 'icon')
    op.drop_column('classroom_courses', 'banner_image_url')
    op.drop_column('classroom_courses', 'banner_color')
    op.drop_column('classroom_courses', 'grade_level')
    op.drop_column('classroom_courses', 'course_type')

    # users 확장 제거
    op.drop_constraint('fk_users_department_id', 'users', type_='foreignkey')
    op.drop_index(op.f('ix_users_user_type'), table_name='users')
    op.drop_index(op.f('ix_users_lifecycle_status'), table_name='users')
    op.drop_index(op.f('ix_users_department_id'), table_name='users')
    op.drop_column('users', 'google_email')
    op.drop_column('users', 'used_bytes')
    op.drop_column('users', 'quota_bytes')
    op.drop_column('users', 'lead_grade')
    op.drop_column('users', 'is_grade_lead')
    op.drop_column('users', 'department_id')
    op.drop_column('users', 'expires_at')
    op.drop_column('users', 'user_type')
    op.drop_column('users', 'lifecycle_status')

    # 새 테이블 제거
    op.drop_index('ix_user_favorite_courses_user_id', table_name='user_favorite_courses')
    op.drop_table('user_favorite_courses')
    op.drop_index('ix_course_teachers_user_id', table_name='classroom_course_teachers')
    op.drop_index('ix_course_teachers_course_id', table_name='classroom_course_teachers')
    op.drop_table('classroom_course_teachers')
    op.drop_index(op.f('ix_departments_lead_user_id'), table_name='departments')
    op.drop_table('departments')
