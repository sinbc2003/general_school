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


class ColumnCreate(BaseModel):
    name: str = Field(default="새 항목", max_length=255)
    system_prompt: str | None = None
    source_config: dict | None = None
    char_min: int | None = None
    char_max: int | None = None
    kind: str = "normal"  # normal | summary


class ColumnUpdate(BaseModel):
    name: str | None = None
    system_prompt: str | None = None
    source_config: dict | None = None
    char_min: int | None = None
    char_max: int | None = None
    kind: str | None = None


class CellUpsert(BaseModel):
    project_id: int
    column_id: int
    student_id: int
    raw_data: str | None = None
    generated_text: str | None = None
    status: str | None = None


class GenerateReq(BaseModel):
    provider: str | None = None
    model_id: str | None = None
    only_student_ids: list[int] | None = None  # 지정 시 이 학생만 생성 (재생성용)


class SpellcheckReq(BaseModel):
    text: str
    provider: str | None = None
    model_id: str | None = None


class PublishReq(BaseModel):
    published: bool = True
