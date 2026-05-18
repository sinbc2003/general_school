"""Shared helpers for student-self sub-modules.

여러 sub-module이 공유하는 직렬화 + 학생 역할 가드.
"""

from fastapi import HTTPException

from app.models.student_self import StudentArtifact, StudentCareerPlan
from app.models.user import User


def _require_student(user: User) -> None:
    """학생 전용 엔드포인트 가드. 비학생 호출 시 403."""
    if user.role != "student":
        raise HTTPException(403, "학생 전용 기능입니다")


def _artifact_to_dict(a: StudentArtifact) -> dict:
    return {
        "id": a.id, "title": a.title, "description": a.description,
        "category": a.category,
        "file_url": a.file_url, "file_name": a.file_name,
        "file_size": a.file_size, "mime_type": a.mime_type,
        "external_link": a.external_link,
        "tags": a.tags or [],
        "is_public": a.is_public,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _plan_to_dict(p: StudentCareerPlan) -> dict:
    return {
        "id": p.id, "year": p.year, "semester_id": p.semester_id,
        "desired_field": p.desired_field, "career_goal": p.career_goal,
        "target_universities": p.target_universities or [],
        "target_majors": p.target_majors or [],
        "academic_plan": p.academic_plan, "activity_plan": p.activity_plan,
        "semester_goals": p.semester_goals or [],
        "motivation": p.motivation, "notes": p.notes,
        "is_active": p.is_active,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
