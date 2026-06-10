"""wordbook — ClassCard형 단어장 (업무 및 수업 도구 Phase 2)

Revision ID: 8e5f2a9b3c1d
Revises: 7c4d1e8f2a3b
Create Date: 2026-06-10

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '8e5f2a9b3c1d'
down_revision: Union[str, Sequence[str], None] = '7c4d1e8f2a3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _has_table('word_decks'):
        op.create_table(
            'word_decks',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('owner_id', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('lang_pair', sa.String(length=20), nullable=False, server_default='en-ko'),
            sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.text('false')),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_word_decks_owner', 'word_decks', ['owner_id'])
        op.create_index('ix_word_decks_public', 'word_decks', ['is_public'])

    if not _has_table('word_cards'):
        op.create_table(
            'word_cards',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('deck_id', sa.Integer(), nullable=False),
            sa.Column('term', sa.String(length=255), nullable=False),
            sa.Column('meaning', sa.String(length=500), nullable=False),
            sa.Column('example', sa.Text(), nullable=True),
            sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
            sa.ForeignKeyConstraint(['deck_id'], ['word_decks.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_word_cards_deck', 'word_cards', ['deck_id', 'sort_order'])

    if not _has_table('word_study_states'):
        op.create_table(
            'word_study_states',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('deck_id', sa.Integer(), nullable=False),
            sa.Column('card_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('box', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('correct_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('wrong_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['deck_id'], ['word_decks.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['card_id'], ['word_cards.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'card_id', name='uq_word_study_user_card'),
        )
        op.create_index('ix_word_study_deck_user', 'word_study_states', ['deck_id', 'user_id'])


def downgrade() -> None:
    for t in ('word_study_states', 'word_cards', 'word_decks'):
        if _has_table(t):
            op.drop_table(t)
