"""add past_researches table

Revision ID: 9d5e6bc2392e
Revises: 6e40a37c4289
Create Date: 2026-05-28 10:05:41.156719

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9d5e6bc2392e'
down_revision: Union[str, Sequence[str], None] = '6e40a37c4289'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'past_researches',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('grade', sa.Integer(), nullable=True),
        sa.Column('semester', sa.Integer(), nullable=True),
        sa.Column('report_type', sa.String(length=64), nullable=True),
        sa.Column('fields', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('is_excellent', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('original_filename', sa.String(length=500), nullable=False),
        sa.Column('stored_path', sa.String(length=500), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('uploaded_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_past_researches_year', 'past_researches', ['year'])
    op.create_index('ix_past_researches_year_semester', 'past_researches', ['year', 'semester'])
    op.create_index('ix_past_researches_report_type', 'past_researches', ['report_type'])


def downgrade() -> None:
    op.drop_index('ix_past_researches_report_type', table_name='past_researches')
    op.drop_index('ix_past_researches_year_semester', table_name='past_researches')
    op.drop_index('ix_past_researches_year', table_name='past_researches')
    op.drop_table('past_researches')
