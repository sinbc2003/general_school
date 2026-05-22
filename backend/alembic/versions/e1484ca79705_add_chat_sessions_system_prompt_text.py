"""add chat_sessions.system_prompt_text

Phase 3 — 강좌 챗봇이 system_prompt_id 대신 inline text 저장하도록 컬럼 추가.

Revision ID: e1484ca79705
Revises: 9a257dd8b420
Create Date: 2026-05-23 02:42:07.548105

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1484ca79705'
down_revision: Union[str, Sequence[str], None] = '9a257dd8b420'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'chat_sessions',
        sa.Column('system_prompt_text', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('chat_sessions', 'system_prompt_text')
