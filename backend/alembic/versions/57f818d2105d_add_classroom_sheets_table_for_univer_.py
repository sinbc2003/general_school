"""add classroom_sheets table for Univer integration

Revision ID: 57f818d2105d
Revises: ef1563390e63
Create Date: 2026-05-20 13:23:15.744589

협업 스프레드시트 (Univer SDK 기반). ClassroomDocument와 동일 패턴:
- ClassroomSheet: 워크북 (yjs_state binary)
- SheetMember: access_mode='specific_users'일 때 명시 권한
- source_survey_id: 설문 결과에서 자동 생성된 시트 추적
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '57f818d2105d'
down_revision: Union[str, Sequence[str], None] = 'ef1563390e63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'classroom_sheets',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('yjs_state', sa.LargeBinary(), nullable=True),
        sa.Column('access_mode', sa.String(length=30), nullable=False),
        sa.Column('source_survey_id', sa.Integer(), nullable=True),
        sa.Column('settings', sa.JSON(), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['classroom_courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_survey_id'], ['classroom_surveys.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_classroom_sheets_course_id', 'classroom_sheets', ['course_id'])
    op.create_index('ix_classroom_sheets_owner_id', 'classroom_sheets', ['owner_id'])
    op.create_index('ix_classroom_sheets_survey_id', 'classroom_sheets', ['source_survey_id'])

    op.create_table(
        'classroom_sheet_members',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('sheet_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['sheet_id'], ['classroom_sheets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('sheet_id', 'user_id', name='uq_sheet_member'),
    )
    op.create_index('ix_classroom_sheet_members_sheet_id', 'classroom_sheet_members', ['sheet_id'])
    op.create_index('ix_classroom_sheet_members_user_id', 'classroom_sheet_members', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_classroom_sheet_members_user_id', table_name='classroom_sheet_members')
    op.drop_index('ix_classroom_sheet_members_sheet_id', table_name='classroom_sheet_members')
    op.drop_table('classroom_sheet_members')
    op.drop_index('ix_classroom_sheets_survey_id', table_name='classroom_sheets')
    op.drop_index('ix_classroom_sheets_owner_id', table_name='classroom_sheets')
    op.drop_index('ix_classroom_sheets_course_id', table_name='classroom_sheets')
    op.drop_table('classroom_sheets')
