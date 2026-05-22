"""add storage_volume_id to artifacts/hwps/assignments

Phase 2-Q Step 2 marker — 자료 모델에 storage_volume_id FK 컬럼 추가.
NULL이면 DEFAULT_STORAGE_ROOT(backend/storage/) 의미, 값이 있으면 해당
StorageVolume.path 사용. 라우팅 통합은 추후 endpoint별 단계에서.

기존 데이터 영향 0 (모두 NULL — 기존 backend/storage/ 사용 유지).
FK는 SET NULL on delete (volume 삭제 시 자료는 보존, DEFAULT로 fallback).

Revision ID: 56636b76fdc3
Revises: 9c3d4e5f6a7b
Create Date: 2026-05-22 19:42:50.455489

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '56636b76fdc3'
down_revision: Union[str, Sequence[str], None] = '9c3d4e5f6a7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add storage_volume_id columns + FKs."""
    # student_artifacts
    op.add_column(
        'student_artifacts',
        sa.Column('storage_volume_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_student_artifacts_storage_volume_id',
        'student_artifacts', 'storage_volumes',
        ['storage_volume_id'], ['id'],
        ondelete='SET NULL',
    )

    # classroom_hwps
    op.add_column(
        'classroom_hwps',
        sa.Column('storage_volume_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_classroom_hwps_storage_volume_id',
        'classroom_hwps', 'storage_volumes',
        ['storage_volume_id'], ['id'],
        ondelete='SET NULL',
    )

    # assignment_submissions
    op.add_column(
        'assignment_submissions',
        sa.Column('storage_volume_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_assignment_submissions_storage_volume_id',
        'assignment_submissions', 'storage_volumes',
        ['storage_volume_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Remove storage_volume_id columns + FKs."""
    op.drop_constraint(
        'fk_assignment_submissions_storage_volume_id',
        'assignment_submissions', type_='foreignkey',
    )
    op.drop_column('assignment_submissions', 'storage_volume_id')

    op.drop_constraint(
        'fk_classroom_hwps_storage_volume_id',
        'classroom_hwps', type_='foreignkey',
    )
    op.drop_column('classroom_hwps', 'storage_volume_id')

    op.drop_constraint(
        'fk_student_artifacts_storage_volume_id',
        'student_artifacts', type_='foreignkey',
    )
    op.drop_column('student_artifacts', 'storage_volume_id')
