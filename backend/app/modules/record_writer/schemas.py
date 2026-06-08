from pydantic import BaseModel, Field


class RecordProjectCreate(BaseModel):
    name: str = Field(default="새 생활기록부", max_length=255)
    # course | homeroom | club | group | research | manual
    scope_type: str = "manual"
    scope_ref_id: int | None = None       # 강좌/동아리/그룹 id
    scope_ref_class: str | None = None    # 담임 학급 "학년-반" (예: "3-2")
    global_prompt: str | None = None


class RecordProjectUpdate(BaseModel):
    name: str | None = None
    global_prompt: str | None = None


class AddStudentsReq(BaseModel):
    student_ids: list[int] = Field(default_factory=list)
