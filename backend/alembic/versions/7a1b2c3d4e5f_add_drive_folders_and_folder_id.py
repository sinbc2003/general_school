"""add drive_folders + folder_id on 5 asset tables

Revision ID: 7a1b2c3d4e5f
Revises: 05a8708cef8d
Create Date: 2026-05-21 23:00:00.000000

도입 배경:
  - 사용자별 폴더 트리 (다단계 중첩) 신설.
  - 5개 협업 도구(docs/sheets/decks/surveys/hwps)에 folder_id FK 추가.
  - 자동 생성 폴더(is_system_locked=True)는 잠금. folder_seed 서비스가 멱등 동기화.

멱등성:
  - 5개 자료의 folder_id 컬럼 추가는 inspector로 존재 검사 후 add_column.
  - drive_folders 테이블도 존재 시 skip.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7a1b2c3d4e5f"
down_revision: Union[str, Sequence[str], None] = "05a8708cef8d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ASSET_TABLES = [
    "classroom_docs",
    "classroom_sheets",
    "classroom_presentations",
    "classroom_surveys",
    "classroom_hwps",
]


def _column_exists(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def _table_exists(bind, table: str) -> bool:
    return table in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "drive_folders"):
        op.create_table(
            "drive_folders",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("owner_id", sa.Integer(), nullable=False),
            sa.Column("parent_id", sa.Integer(), nullable=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("auto_kind", sa.String(length=40), nullable=True),
            sa.Column("semester_id", sa.Integer(), nullable=True),
            sa.Column("source_kind", sa.String(length=40), nullable=True),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "is_system_locked", sa.Boolean(), nullable=False, server_default=sa.false(),
            ),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.Integer(), nullable=True),
            sa.Column(
                "created_at", sa.DateTime(timezone=True),
                server_default=sa.func.now(), nullable=False,
            ),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True),
                server_default=sa.func.now(), nullable=False,
            ),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["parent_id"], ["drive_folders.id"], ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["semester_id"], ["semesters.id"], ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "owner_id", "auto_kind", "semester_id", "source_kind", "source_id",
                name="uq_drive_folder_auto_idem",
            ),
        )
        op.create_index(
            "ix_drive_folders_owner_id", "drive_folders", ["owner_id"],
        )
        op.create_index(
            "ix_drive_folders_parent_id", "drive_folders", ["parent_id"],
        )
        op.create_index(
            "ix_drive_folders_auto_kind", "drive_folders", ["auto_kind"],
        )
        op.create_index(
            "ix_drive_folders_semester_id", "drive_folders", ["semester_id"],
        )
        op.create_index(
            "ix_drive_folders_deleted_at", "drive_folders", ["deleted_at"],
        )
        op.create_index(
            "ix_drive_folders_owner_parent",
            "drive_folders", ["owner_id", "parent_id"],
        )
        op.create_index(
            "ix_drive_folders_owner_auto",
            "drive_folders",
            ["owner_id", "auto_kind", "semester_id", "source_kind", "source_id"],
        )

    for table in _ASSET_TABLES:
        if _table_exists(bind, table) and not _column_exists(bind, table, "folder_id"):
            op.add_column(
                table, sa.Column("folder_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                f"fk_{table}_folder_id",
                table,
                "drive_folders",
                ["folder_id"],
                ["id"],
                ondelete="SET NULL",
            )
            op.create_index(
                f"ix_{table}_folder_id", table, ["folder_id"],
            )


def downgrade() -> None:
    bind = op.get_bind()

    for table in _ASSET_TABLES:
        if _column_exists(bind, table, "folder_id"):
            try:
                op.drop_index(f"ix_{table}_folder_id", table_name=table)
            except Exception:
                pass
            try:
                op.drop_constraint(f"fk_{table}_folder_id", table, type_="foreignkey")
            except Exception:
                pass
            op.drop_column(table, "folder_id")

    if _table_exists(bind, "drive_folders"):
        for idx in (
            "ix_drive_folders_owner_auto",
            "ix_drive_folders_owner_parent",
            "ix_drive_folders_deleted_at",
            "ix_drive_folders_semester_id",
            "ix_drive_folders_auto_kind",
            "ix_drive_folders_parent_id",
            "ix_drive_folders_owner_id",
        ):
            try:
                op.drop_index(idx, table_name="drive_folders")
            except Exception:
                pass
        op.drop_table("drive_folders")
