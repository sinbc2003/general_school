"""add chat_session source_chatbot_id

강좌 챗봇으로 시작된 ChatSession을 학생 챗봇 리스트에서 시각 구분하기 위한 FK.
챗봇 삭제 시 SET NULL — 세션·메시지는 보존하고 origin 표시만 사라짐.

Revision ID: 6e40a37c4289
Revises: b5e9c8a3f1d2
Create Date: 2026-05-26 14:48:52.451351

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e40a37c4289'
down_revision: Union[str, Sequence[str], None] = 'b5e9c8a3f1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # autogenerate가 다른 모듈의 partial/trgm/multi-column 인덱스를 false-positive로
    # drop 목록에 잡았으나 모두 운영 인덱스이므로 제외. source_chatbot_id 컬럼만 추가.
    op.add_column(
        'chat_sessions',
        sa.Column('source_chatbot_id', sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f('ix_chat_sessions_source_chatbot_id'),
        'chat_sessions',
        ['source_chatbot_id'],
        unique=False,
    )
    op.create_foreign_key(
        'fk_chat_sessions_source_chatbot_id',
        'chat_sessions', 'course_chatbots',
        ['source_chatbot_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'fk_chat_sessions_source_chatbot_id',
        'chat_sessions',
        type_='foreignkey',
    )
    op.drop_index(
        op.f('ix_chat_sessions_source_chatbot_id'),
        table_name='chat_sessions',
    )
    op.drop_column('chat_sessions', 'source_chatbot_id')
