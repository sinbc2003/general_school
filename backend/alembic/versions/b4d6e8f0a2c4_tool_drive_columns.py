"""tool drive columns — 단어장·보드 내 드라이브 통합 (폴더·휴지통)

Revision ID: b4d6e8f0a2c4
Revises: a2c4e6f8b1d3
Create Date: 2026-06-11

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b4d6e8f0a2c4'
down_revision: Union[str, Sequence[str], None] = 'a2c4e6f8b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, col: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return True  # 테이블 없으면 skip (init_db가 만들 것)
    return col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    # word_decks — 드라이브 통합 4컬럼
    if not _has_column('word_decks', 'folder_id'):
        op.add_column('word_decks', sa.Column('folder_id', sa.Integer(), nullable=True))
        op.create_foreign_key(
            'fk_word_decks_folder', 'word_decks', 'drive_folders',
            ['folder_id'], ['id'], ondelete='SET NULL',
        )
        op.create_index('ix_word_decks_folder_id', 'word_decks', ['folder_id'])
    if not _has_column('word_decks', 'deleted_at'):
        op.add_column('word_decks', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    if not _has_column('word_decks', 'deleted_by'):
        op.add_column('word_decks', sa.Column('deleted_by', sa.Integer(), nullable=True))
        op.create_foreign_key(
            'fk_word_decks_deleted_by', 'word_decks', 'users',
            ['deleted_by'], ['id'], ondelete='SET NULL',
        )
    if not _has_column('word_decks', 'storage_bytes'):
        op.add_column('word_decks', sa.Column(
            'storage_bytes', sa.Integer(), nullable=False, server_default='0',
        ))

    # tool_boards — 드라이브 통합 3컬럼 (storage_bytes는 이미 있음)
    if not _has_column('tool_boards', 'folder_id'):
        op.add_column('tool_boards', sa.Column('folder_id', sa.Integer(), nullable=True))
        op.create_foreign_key(
            'fk_tool_boards_folder', 'tool_boards', 'drive_folders',
            ['folder_id'], ['id'], ondelete='SET NULL',
        )
        op.create_index('ix_tool_boards_folder_id', 'tool_boards', ['folder_id'])
    if not _has_column('tool_boards', 'deleted_at'):
        op.add_column('tool_boards', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    if not _has_column('tool_boards', 'deleted_by'):
        op.add_column('tool_boards', sa.Column('deleted_by', sa.Integer(), nullable=True))
        op.create_foreign_key(
            'fk_tool_boards_deleted_by', 'tool_boards', 'users',
            ['deleted_by'], ['id'], ondelete='SET NULL',
        )


def downgrade() -> None:
    for table, cols in (
        ('word_decks', ['folder_id', 'deleted_at', 'deleted_by', 'storage_bytes']),
        ('tool_boards', ['folder_id', 'deleted_at', 'deleted_by']),
    ):
        for col in cols:
            try:
                op.drop_column(table, col)
            except Exception:
                pass
