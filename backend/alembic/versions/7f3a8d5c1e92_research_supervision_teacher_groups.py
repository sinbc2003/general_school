"""research_supervision + teacher_groups + group_submissions + past_research/club_submissions 승인 컬럼

PostgreSQL IF NOT EXISTS 멱등 — dev에서 backend init_db가 이미 만든 테이블/컬럼은 skip.

Revision ID: 7f3a8d5c1e92
Revises: 9d5e6bc2392e
Create Date: 2026-05-28 11:30:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = '7f3a8d5c1e92'
down_revision: Union[str, Sequence[str], None] = '9d5e6bc2392e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── PastResearch 승인 컬럼 ──
    op.execute("ALTER TABLE past_researches ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved'")
    op.execute("ALTER TABLE past_researches ADD COLUMN IF NOT EXISTS submitted_by_student_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE past_researches ADD COLUMN IF NOT EXISTS supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE past_researches ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE past_researches ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500)")
    op.execute("ALTER TABLE past_researches ADD COLUMN IF NOT EXISTS student_artifact_id INTEGER REFERENCES student_artifacts(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_past_researches_status ON past_researches (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_past_researches_supervisor_status ON past_researches (supervisor_id, status)")

    # ── ClubSubmission 승인 컬럼 ──
    op.execute("ALTER TABLE club_submissions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved'")
    op.execute("ALTER TABLE club_submissions ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE club_submissions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE club_submissions ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500)")
    op.execute("ALTER TABLE club_submissions ADD COLUMN IF NOT EXISTS student_artifact_id INTEGER REFERENCES student_artifacts(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_club_submissions_status ON club_submissions (status)")

    # ── ResearchSupervision ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS research_supervisions (
            id SERIAL PRIMARY KEY,
            semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            supervisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            topic_title VARCHAR(300),
            note TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_research_supervisions_sem_student UNIQUE (semester_id, student_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_research_supervisions_supervisor ON research_supervisions (supervisor_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_research_supervisions_student ON research_supervisions (student_id)")

    # ── TeacherGroup ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS teacher_groups (
            id SERIAL PRIMARY KEY,
            semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
            name VARCHAR(200) NOT NULL,
            type VARCHAR(20) NOT NULL DEFAULT 'event',
            description TEXT,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_teacher_groups_semester ON teacher_groups (semester_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_teacher_groups_owner ON teacher_groups (owner_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_teacher_groups_type ON teacher_groups (type)")

    # ── TeacherGroupMember ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS teacher_group_members (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL REFERENCES teacher_groups(id) ON DELETE CASCADE,
            teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL DEFAULT 'member',
            invited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_teacher_group_members UNIQUE (group_id, teacher_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_teacher_group_members_teacher ON teacher_group_members (teacher_id)")

    # ── TeacherGroupStudent ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS teacher_group_students (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL REFERENCES teacher_groups(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            assigned_teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            note TEXT,
            assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_teacher_group_students UNIQUE (group_id, student_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_teacher_group_students_group ON teacher_group_students (group_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_teacher_group_students_student ON teacher_group_students (student_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_teacher_group_students_assigned_teacher ON teacher_group_students (assigned_teacher_id)")

    # ── GroupSubmission ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS group_submissions (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL REFERENCES teacher_groups(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            file_url VARCHAR(500),
            file_name VARCHAR(255),
            file_size INTEGER,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            reviewed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMP WITH TIME ZONE,
            rejection_reason TEXT,
            student_artifact_id INTEGER REFERENCES student_artifacts(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_group_submissions_group_status ON group_submissions (group_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_group_submissions_student ON group_submissions (student_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_group_submissions_status ON group_submissions (status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS group_submissions")
    op.execute("DROP TABLE IF EXISTS teacher_group_students")
    op.execute("DROP TABLE IF EXISTS teacher_group_members")
    op.execute("DROP TABLE IF EXISTS teacher_groups")
    op.execute("DROP TABLE IF EXISTS research_supervisions")
    for col in ("student_artifact_id", "rejection_reason", "reviewed_at", "reviewed_by_id", "status"):
        op.execute(f"ALTER TABLE club_submissions DROP COLUMN IF EXISTS {col}")
    for col in ("student_artifact_id", "rejection_reason", "reviewed_at", "supervisor_id", "submitted_by_student_id", "status"):
        op.execute(f"ALTER TABLE past_researches DROP COLUMN IF EXISTS {col}")
