"""tool poll — Mentimeter형 실시간 투표·워드클라우드 (업무 및 수업 도구 #6)

Revision ID: e0b2d4f6a8c0
Revises: d8f0a2c4e6b8
Create Date: 2026-06-12

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON

revision: str = 'e0b2d4f6a8c0'
down_revision: Union[str, Sequence[str], None] = 'd8f0a2c4e6b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _has_table('tool_polls'):
        op.create_table(
            'tool_polls',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('owner_id', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('questions', JSON(), nullable=True),
            sa.Column('settings', JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('folder_id', sa.Integer(), nullable=True),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('deleted_by', sa.Integer(), nullable=True),
            sa.Column('storage_bytes', sa.Integer(), nullable=False, server_default='0'),
            sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['folder_id'], ['drive_folders.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_tool_polls_owner', 'tool_polls', ['owner_id', 'deleted_at'])
        op.create_index('ix_tool_polls_folder_id', 'tool_polls', ['folder_id'])

    if not _has_table('tool_poll_sessions'):
        op.create_table(
            'tool_poll_sessions',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('poll_id', sa.Integer(), nullable=True),
            sa.Column('host_id', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('pin', sa.String(length=6), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='lobby'),
            sa.Column('current_index', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('questions', JSON(), nullable=True),
            sa.Column('settings', JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['poll_id'], ['tool_polls.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['host_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_tool_poll_sessions_pin_status', 'tool_poll_sessions', ['pin', 'status'])
        op.create_index('ix_tool_poll_sessions_host', 'tool_poll_sessions', ['host_id', 'created_at'])

    if not _has_table('tool_poll_participants'):
        op.create_table(
            'tool_poll_participants',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('session_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('nickname', sa.String(length=50), nullable=False),
            sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['session_id'], ['tool_poll_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('session_id', 'user_id', name='uq_poll_participant_session_user'),
        )
        op.create_index('ix_tool_poll_participants_session', 'tool_poll_participants', ['session_id'])

    if not _has_table('tool_poll_responses'):
        op.create_table(
            'tool_poll_responses',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('session_id', sa.Integer(), nullable=False),
            sa.Column('participant_id', sa.Integer(), nullable=False),
            sa.Column('question_id', sa.String(length=50), nullable=False),
            sa.Column('answer', JSON(), nullable=True),
            sa.Column('answer_no', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['session_id'], ['tool_poll_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['participant_id'], ['tool_poll_participants.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint(
                'session_id', 'participant_id', 'question_id', 'answer_no',
                name='uq_poll_response_slot',
            ),
        )
        op.create_index(
            'ix_tool_poll_responses_session_question',
            'tool_poll_responses', ['session_id', 'question_id'],
        )


def downgrade() -> None:
    for t in ('tool_poll_responses', 'tool_poll_participants', 'tool_poll_sessions', 'tool_polls'):
        if _has_table(t):
            op.drop_table(t)
