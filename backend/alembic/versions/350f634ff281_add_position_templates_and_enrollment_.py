"""add position templates and enrollment positions

학기·직책 기반 권한 위임 모델 도입.

- PositionTemplate: 직책/업무분장별 권한 키 묶음 (예 "1학년 담임" → 일부 권한)
- EnrollmentPosition: 학기 enrollment에 직책 할당 (N:N). 학기가 바뀌면 새
  enrollment에 별도로 할당해야 함 → 자동 회수.

Revision ID: 350f634ff281
Revises: aecd1b24845e
Create Date: 2026-05-18

Note: 자동생성 결과에서 community_*, meeting_*, meeting_attachments drop과
student_career_plans 가짜 FK 재생성은 의도 외라 제거.
- community/meeting 테이블은 정책상 보존 (CLAUDE.md "DB 테이블은 보존")
- student_career_plans FK는 SQLite/PG 메타데이터 노이즈 — 실제 변경 없음
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '350f634ff281'
down_revision: Union[str, Sequence[str], None] = 'aecd1b24845e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'position_templates',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('key', sa.String(length=100), nullable=False),
        sa.Column('display_name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(length=50), nullable=False),
        sa.Column('permission_keys', sa.Text(), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_position_templates_key'),
        'position_templates', ['key'], unique=True,
    )

    op.create_table(
        'enrollment_positions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('enrollment_id', sa.Integer(), nullable=False),
        sa.Column('position_template_id', sa.Integer(), nullable=False),
        sa.Column('granted_by', sa.Integer(), nullable=True),
        sa.Column('note', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(
            ['enrollment_id'], ['semester_enrollments.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['position_template_id'], ['position_templates.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'enrollment_id', 'position_template_id',
            name='uq_enrollment_position',
        ),
    )
    op.create_index(
        'ix_enrollment_positions_enrollment_id',
        'enrollment_positions', ['enrollment_id'], unique=False,
    )
    op.create_index(
        'ix_enrollment_positions_template_id',
        'enrollment_positions', ['position_template_id'], unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'ix_enrollment_positions_template_id',
        table_name='enrollment_positions',
    )
    op.drop_index(
        'ix_enrollment_positions_enrollment_id',
        table_name='enrollment_positions',
    )
    op.drop_table('enrollment_positions')

    op.drop_index(
        op.f('ix_position_templates_key'),
        table_name='position_templates',
    )
    op.drop_table('position_templates')
