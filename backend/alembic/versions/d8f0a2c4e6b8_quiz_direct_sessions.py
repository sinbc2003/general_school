"""quiz direct sessions — problem_set_id nullable (도구에서 직접 출제)

Revision ID: d8f0a2c4e6b8
Revises: c6e8f0a2b4d6
Create Date: 2026-06-11

수동 작성 + 멱등.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd8f0a2c4e6b8'
down_revision: Union[str, Sequence[str], None] = 'c6e8f0a2b4d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table('live_quiz_sessions'):
        return  # init_db가 nullable로 생성
    cols = {c['name']: c for c in insp.get_columns('live_quiz_sessions')}
    col = cols.get('problem_set_id')
    if col is not None and col.get('nullable') is False:
        op.alter_column(
            'live_quiz_sessions', 'problem_set_id',
            existing_type=sa.Integer(), nullable=True,
        )


def downgrade() -> None:
    # NULL row가 생긴 뒤엔 되돌릴 수 없음 — no-op
    pass
