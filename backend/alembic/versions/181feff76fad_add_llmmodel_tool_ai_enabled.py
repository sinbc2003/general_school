"""add LLMModel.tool_ai_enabled

Revision ID: 181feff76fad
Revises: 08f6e077c897
Create Date: 2026-05-21 11:14:42.077997

AI 도우미(문서/시트/슬라이드/설문 작성) 기능에서 사용 가능한 모델 화이트리스트.
super_admin이 /system/llm/models 페이지에서 토글.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '181feff76fad'
down_revision: Union[str, Sequence[str], None] = '08f6e077c897'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'llm_models',
        sa.Column(
            'tool_ai_enabled',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column('llm_models', 'tool_ai_enabled')
