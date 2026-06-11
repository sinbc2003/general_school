"""tool whiteboards — 공유 화이트보드 (실시간 드로잉, 업무 및 수업 도구)

Revision ID: c6e8f0a2b4d6
Revises: b4d6e8f0a2c4
Create Date: 2026-06-11

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON

revision: str = 'c6e8f0a2b4d6'
down_revision: Union[str, Sequence[str], None] = 'b4d6e8f0a2c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if _has_table('tool_whiteboards'):
        return
    op.create_table(
        'tool_whiteboards',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('course_id', sa.Integer(), nullable=True),
        sa.Column('access_mode', sa.String(length=20), nullable=False, server_default='members'),
        sa.Column('settings', JSON(), nullable=True),
        sa.Column('yjs_state', sa.LargeBinary(), nullable=True),
        sa.Column('storage_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('folder_id', sa.Integer(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['course_id'], ['classroom_courses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['folder_id'], ['drive_folders.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tool_whiteboards_owner', 'tool_whiteboards', ['owner_id'])
    op.create_index('ix_tool_whiteboards_course', 'tool_whiteboards', ['course_id'])
    op.create_index('ix_tool_whiteboards_folder_id', 'tool_whiteboards', ['folder_id'])


def downgrade() -> None:
    if _has_table('tool_whiteboards'):
        op.drop_table('tool_whiteboards')
