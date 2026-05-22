"""add course_chatbots

Phase 3 — 강좌별 챗봇 (시스템 프롬프트 + 옵션 모델 지정).

Revision ID: 9a257dd8b420
Revises: 1249664b8dad
Create Date: 2026-05-23 02:34:56.496096

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9a257dd8b420'
down_revision: Union[str, Sequence[str], None] = '1249664b8dad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'course_chatbots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('system_prompt', sa.Text(), nullable=False),
        sa.Column('provider', sa.String(length=30), nullable=True),
        sa.Column('model_id', sa.String(length=150), nullable=True),
        sa.Column('context_attachments', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['course_id'], ['classroom_courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_course_chatbots_course_id', 'course_chatbots', ['course_id'])


def downgrade() -> None:
    op.drop_index('ix_course_chatbots_course_id', table_name='course_chatbots')
    op.drop_table('course_chatbots')
