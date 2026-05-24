"""add courseware llm grading_status and llm_metadata to student_problem_attempts

Revision ID: b5e9c8a3f1d2
Revises: acccc2f57668
Create Date: 2026-05-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b5e9c8a3f1d2'
down_revision: Union[str, Sequence[str], None] = 'acccc2f57668'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add grading_status + llm_metadata to student_problem_attempts.

    grading_status:
      - 'none'   : LLM 채점 대상 아님 (자동채점 가능 grader)
      - 'pending': LLM 채점 대기 (학생 제출 직후 settings.llm_grader_enabled)
      - 'running': background task가 채점 중
      - 'done'   : 채점 완료 (manual_score 채워짐)
      - 'failed' : LLM 호출/파싱 실패 (llm_metadata.error)

    llm_metadata: provider/model/tokens/cost/raw_response 보관 (감사·재현·비용 추적).
    """
    op.add_column(
        'student_problem_attempts',
        sa.Column(
            'grading_status', sa.String(length=20),
            nullable=False, server_default='none',
        ),
    )
    op.add_column(
        'student_problem_attempts',
        sa.Column('llm_metadata', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    # 채점 대기·실행 중인 attempt를 빠르게 찾기 위한 partial-ish index
    op.create_index(
        'ix_attempts_grading_status', 'student_problem_attempts',
        ['grading_status'], unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_attempts_grading_status', table_name='student_problem_attempts')
    op.drop_column('student_problem_attempts', 'llm_metadata')
    op.drop_column('student_problem_attempts', 'grading_status')
