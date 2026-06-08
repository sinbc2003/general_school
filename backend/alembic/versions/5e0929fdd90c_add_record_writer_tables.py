"""add record writer tables

Revision ID: 5e0929fdd90c
Revises: 7f3a8d5c1e92
Create Date: 2026-06-09 00:26:47.650451

NOTE: autogenerate가 모델에 없고 migration으로만 추가된 기존 성능/trgm 인덱스들을
drop하려는 잡음을 포함했었음 → 수동 제거. 본 revision은 record_writer 4개 테이블
생성만 수행한다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5e0929fdd90c'
down_revision: Union[str, Sequence[str], None] = '7f3a8d5c1e92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'record_projects',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('semester_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('scope_type', sa.String(length=20), nullable=False),
        sa.Column('scope_ref_id', sa.Integer(), nullable=True),
        sa.Column('scope_ref_class', sa.String(length=20), nullable=True),
        sa.Column('global_prompt', sa.Text(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['semester_id'], ['semesters.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_record_projects_deleted_at'), 'record_projects', ['deleted_at'], unique=False)
    op.create_index('ix_record_projects_owner_id', 'record_projects', ['owner_id'], unique=False)
    op.create_index('ix_record_projects_semester_id', 'record_projects', ['semester_id'], unique=False)

    op.create_table(
        'record_columns',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('display_order', sa.Integer(), nullable=False),
        sa.Column('system_prompt', sa.Text(), nullable=True),
        sa.Column('source_config', sa.JSON(), nullable=True),
        sa.Column('char_min', sa.Integer(), nullable=True),
        sa.Column('char_max', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['record_projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_record_columns_project_id', 'record_columns', ['project_id'], unique=False)

    op.create_table(
        'record_project_students',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('display_order', sa.Integer(), nullable=False),
        sa.Column('final_text', sa.Text(), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['record_projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'student_id', name='uq_record_project_student'),
    )
    op.create_index('ix_record_project_students_project_id', 'record_project_students', ['project_id'], unique=False)
    op.create_index('ix_record_project_students_student_id', 'record_project_students', ['student_id'], unique=False)

    op.create_table(
        'record_cells',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('column_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('raw_data', sa.Text(), nullable=True),
        sa.Column('raw_sources', sa.JSON(), nullable=True),
        sa.Column('generated_text', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('similarity_flag', sa.Float(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['column_id'], ['record_columns.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['record_projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('column_id', 'student_id', name='uq_record_cell'),
    )
    op.create_index('ix_record_cells_column_id', 'record_cells', ['column_id'], unique=False)
    op.create_index('ix_record_cells_project_id', 'record_cells', ['project_id'], unique=False)
    op.create_index('ix_record_cells_student_id', 'record_cells', ['student_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_record_cells_student_id', table_name='record_cells')
    op.drop_index('ix_record_cells_project_id', table_name='record_cells')
    op.drop_index('ix_record_cells_column_id', table_name='record_cells')
    op.drop_table('record_cells')
    op.drop_index('ix_record_project_students_student_id', table_name='record_project_students')
    op.drop_index('ix_record_project_students_project_id', table_name='record_project_students')
    op.drop_table('record_project_students')
    op.drop_index('ix_record_columns_project_id', table_name='record_columns')
    op.drop_table('record_columns')
    op.drop_index('ix_record_projects_semester_id', table_name='record_projects')
    op.drop_index('ix_record_projects_owner_id', table_name='record_projects')
    op.drop_index(op.f('ix_record_projects_deleted_at'), table_name='record_projects')
    op.drop_table('record_projects')
