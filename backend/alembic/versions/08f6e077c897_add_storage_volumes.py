"""add_storage_volumes

Phase 2-Q: 외장 SSD/HDD 추가 인식 및 자동 분산 인프라.

Revision ID: 08f6e077c897
Revises: 259af386dcc1
Create Date: 2026-05-20 17:34:04.774448

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '08f6e077c897'
down_revision: Union[str, Sequence[str], None] = '259af386dcc1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'storage_volumes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('path', sa.String(length=500), nullable=False),
        sa.Column('capacity_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('used_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('last_status', sa.String(length=20), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )


def downgrade() -> None:
    op.drop_table('storage_volumes')
