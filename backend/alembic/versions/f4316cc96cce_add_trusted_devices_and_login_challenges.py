"""add trusted devices and login challenges

이메일 2FA 흐름:
- TrustedDevice: '이 장치 기억' 옵션으로 등록된 장치. device_token hash 저장.
- LoginChallenge: 비밀번호 통과 후 이메일 코드 검증 대기 중인 임시 챌린지.

신규 학교 설치 흐름에서 'alembic upgrade head' 실행 시 두 테이블 생성.
기존 dev 환경(create_all로 이미 존재)은 IF NOT EXISTS 패턴으로 안전.

Revision ID: f4316cc96cce
Revises: 92ee67e77ac7
Create Date: 2026-05-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4316cc96cce'
down_revision: Union[str, Sequence[str], None] = '92ee67e77ac7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 기존 dev 환경(create_all로 이미 존재) 안전 처리 — checkfirst.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if 'trusted_devices' not in existing_tables:
        op.create_table(
            'trusted_devices',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('token_hash', sa.String(length=255), nullable=False),
            sa.Column('label', sa.String(length=200), nullable=True),
            sa.Column('ip_address', sa.String(length=45), nullable=True),
            sa.Column('user_agent', sa.Text(), nullable=True),
            sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('token_hash'),
        )
        op.create_index('ix_trusted_devices_user_id', 'trusted_devices', ['user_id'], unique=False)

    if 'login_challenges' not in existing_tables:
        op.create_table(
            'login_challenges',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('challenge_token', sa.String(length=64), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('code_hash', sa.String(length=255), nullable=False),
            sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('consumed', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('ip_address', sa.String(length=45), nullable=True),
            sa.Column('user_agent', sa.Text(), nullable=True),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('challenge_token'),
        )
        op.create_index('ix_login_challenges_user_id', 'login_challenges', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_login_challenges_user_id', table_name='login_challenges')
    op.drop_table('login_challenges')

    op.drop_index('ix_trusted_devices_user_id', table_name='trusted_devices')
    op.drop_table('trusted_devices')
