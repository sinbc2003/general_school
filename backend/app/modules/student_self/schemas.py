"""Pydantic schemas for student-self endpoints."""

from pydantic import BaseModel, Field


class ArtifactUpdate(BaseModel):
    """PUT /api/me/artifacts/{aid} — 부분 업데이트."""
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    category: str | None = Field(None, max_length=50)
    external_link: str | None = Field(None, max_length=500)
    is_public: bool | None = None
    tags: list[str] | None = None


class CareerPlanUpsert(BaseModel):
    """PUT /api/me/career-plans/active — 현재 학기 진로 계획 upsert.

    학기당 1개. 모든 필드 optional (점진적 작성 허용).
    """
    desired_field: str | None = Field(None, max_length=200)
    career_goal: str | None = None
    target_universities: list[str] | None = None
    target_majors: list[str] | None = None
    academic_plan: str | None = None
    activity_plan: str | None = None
    semester_goals: list[str] | None = None
    motivation: str | None = None
    notes: str | None = None


class CareerPlanCreate(BaseModel):
    """POST /api/me/career-plans — 다년 모드 호환 (legacy)."""
    year: int | None = Field(None, ge=2000, le=2100)
    desired_field: str | None = Field(None, max_length=200)
    career_goal: str | None = None
    target_universities: list[str] | None = None
    target_majors: list[str] | None = None
    academic_plan: str | None = None
    activity_plan: str | None = None
    semester_goals: list[str] | None = None
    motivation: str | None = None
    notes: str | None = None


class CareerPlanUpdate(BaseModel):
    """PUT /api/me/career-plans/{pid} — 부분 업데이트."""
    year: int | None = Field(None, ge=2000, le=2100)
    desired_field: str | None = Field(None, max_length=200)
    career_goal: str | None = None
    target_universities: list[str] | None = None
    target_majors: list[str] | None = None
    academic_plan: str | None = None
    activity_plan: str | None = None
    semester_goals: list[str] | None = None
    motivation: str | None = None
    notes: str | None = None
    is_active: bool | None = None


class SubmissionPortfolioVisibility(BaseModel):
    """PUT /api/me/assignment-submissions/{sub_id}/portfolio-visibility"""
    show_in_portfolio: bool = False


class ClubSubmissionUpdate(BaseModel):
    """PUT /api/me/club-submissions/{sub_id}"""
    title: str | None = Field(None, min_length=1, max_length=200)
    submission_type: str | None = Field(None, min_length=1, max_length=30)
