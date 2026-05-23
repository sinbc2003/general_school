"""add courseware: problem.answer_data + CourseProblemSet + StudentProblemAttempt

Revision ID: acccc2f57668
Revises: e1484ca79705
Create Date: 2026-05-23 19:13:41.355325

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'acccc2f57668'
down_revision: Union[str, Sequence[str], None] = 'e1484ca79705'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add courseware tables + answer_data column."""
    op.create_table(
        'course_problem_sets',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('problem_ids', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('time_limit_seconds', sa.Integer(), nullable=True),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('show_solution_after_due', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('settings', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['course_id'], ['classroom_courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_course_problem_sets_course_id', 'course_problem_sets', ['course_id'], unique=False)
    op.create_index('ix_course_problem_sets_status', 'course_problem_sets', ['status'], unique=False)
    op.create_index('ix_course_problem_sets_course_active', 'course_problem_sets', ['course_id', 'status', 'deleted_at'], unique=False)

    op.create_table(
        'student_problem_attempts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('problem_set_id', sa.Integer(), nullable=False),
        sa.Column('problem_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('attempt_number', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('answer_data', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('is_correct', sa.Boolean(), nullable=True),
        sa.Column('auto_score', sa.Float(), nullable=True),
        sa.Column('manual_score', sa.Float(), nullable=True),
        sa.Column('manual_feedback', sa.Text(), nullable=True),
        sa.Column('graded_by', sa.Integer(), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('graded_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['graded_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['problem_id'], ['problems.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['problem_set_id'], ['course_problem_sets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('problem_set_id', 'problem_id', 'student_id', 'attempt_number', name='uq_attempt_set_problem_student_n'),
    )
    op.create_index('ix_attempts_set_problem', 'student_problem_attempts', ['problem_set_id', 'problem_id'], unique=False)
    op.create_index('ix_attempts_set_student', 'student_problem_attempts', ['problem_set_id', 'student_id'], unique=False)
    op.create_index('ix_attempts_student_submitted', 'student_problem_attempts', ['student_id', 'submitted_at'], unique=False)

    # Problem 자동채점 메타 (구조화 답)
    op.add_column('problems', sa.Column('answer_data', postgresql.JSON(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('problems', 'answer_data')
    op.drop_index('ix_attempts_student_submitted', table_name='student_problem_attempts')
    op.drop_index('ix_attempts_set_student', table_name='student_problem_attempts')
    op.drop_index('ix_attempts_set_problem', table_name='student_problem_attempts')
    op.drop_table('student_problem_attempts')
    op.drop_index('ix_course_problem_sets_course_active', table_name='course_problem_sets')
    op.drop_index('ix_course_problem_sets_status', table_name='course_problem_sets')
    op.drop_index('ix_course_problem_sets_course_id', table_name='course_problem_sets')
    op.drop_table('course_problem_sets')
