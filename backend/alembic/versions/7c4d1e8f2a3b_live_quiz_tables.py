"""live quiz — Kahoot형 라이브 퀴즈 (업무 및 수업 도구 Phase 1)

Revision ID: 7c4d1e8f2a3b
Revises: 5b2c3d4a9e1f
Create Date: 2026-06-10

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON

revision: str = '7c4d1e8f2a3b'
down_revision: Union[str, Sequence[str], None] = '5b2c3d4a9e1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _has_table('live_quiz_sessions'):
        op.create_table(
            'live_quiz_sessions',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('problem_set_id', sa.Integer(), nullable=False),
            sa.Column('host_id', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('pin', sa.String(length=6), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='lobby'),
            sa.Column('current_index', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('question_started_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('problem_ids', JSON(), nullable=True),
            sa.Column('settings', JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['problem_set_id'], ['course_problem_sets.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['host_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_live_quiz_sessions_pin_status', 'live_quiz_sessions', ['pin', 'status'])
        op.create_index('ix_live_quiz_sessions_host', 'live_quiz_sessions', ['host_id', 'created_at'])

    if not _has_table('live_quiz_players'):
        op.create_table(
            'live_quiz_players',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('session_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('nickname', sa.String(length=50), nullable=False),
            sa.Column('score', sa.Float(), nullable=False, server_default='0'),
            sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['session_id'], ['live_quiz_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('session_id', 'user_id', name='uq_quiz_player_session_user'),
        )
        op.create_index('ix_live_quiz_players_session', 'live_quiz_players', ['session_id'])

    if not _has_table('live_quiz_answers'):
        op.create_table(
            'live_quiz_answers',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('session_id', sa.Integer(), nullable=False),
            sa.Column('player_id', sa.Integer(), nullable=False),
            sa.Column('problem_id', sa.Integer(), nullable=False),
            sa.Column('answer', JSON(), nullable=True),
            sa.Column('is_correct', sa.Boolean(), nullable=True),
            sa.Column('ms_taken', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('points', sa.Float(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['session_id'], ['live_quiz_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['player_id'], ['live_quiz_players.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['problem_id'], ['problems.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('session_id', 'player_id', 'problem_id', name='uq_quiz_answer_session_player_problem'),
        )
        op.create_index('ix_live_quiz_answers_session_problem', 'live_quiz_answers', ['session_id', 'problem_id'])


def downgrade() -> None:
    for t in ('live_quiz_answers', 'live_quiz_players', 'live_quiz_sessions'):
        if _has_table(t):
            op.drop_table(t)
