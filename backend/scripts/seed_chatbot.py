"""챗봇 기본 시드 — 모델 가격, 시스템 프롬프트, 전역 설정

기존 데이터 보존 (key/(provider+model_id) 기준 새것만 추가).
가격 정보는 2025-05 기준 추정값 — 관리자 페이지에서 수정 가능.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chatbot import ChatbotConfig, LLMModel, SystemPrompt


# (provider, model_id, display_name, input_per_1m, output_per_1m, context_window, sort_order)
DEFAULT_MODELS = [
    # Anthropic — 최신 우선
    ("anthropic", "claude-opus-4-7", "Claude Opus 4.7 (최강)", 15.0, 75.0, 200000, 1),
    ("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6 (균형)", 3.0, 15.0, 200000, 2),
    ("anthropic", "claude-haiku-4-5-20251001", "Claude Haiku 4.5 (빠름/저렴)", 1.0, 5.0, 200000, 3),

    # OpenAI
    ("openai", "gpt-4o", "GPT-4o", 2.5, 10.0, 128000, 10),
    ("openai", "gpt-4o-mini", "GPT-4o mini (저렴)", 0.15, 0.60, 128000, 11),
    ("openai", "o3-mini", "o3-mini (추론)", 1.10, 4.40, 200000, 12),

    # Google Gemini
    ("google", "gemini-2.5-pro", "Gemini 2.5 Pro", 1.25, 10.0, 2000000, 20),
    ("google", "gemini-2.5-flash", "Gemini 2.5 Flash (빠름)", 0.075, 0.30, 1000000, 21),
    ("google", "gemini-2.0-flash", "Gemini 2.0 Flash", 0.10, 0.40, 1000000, 22),
]


DEFAULT_PROMPTS = [
    {
        "name": "교사용 기본",
        "audience": "teacher",
        "is_default": True,
        "sort_order": 1,
        "content": (
            "당신은 한국 고등학교 교사를 보조하는 AI 어시스턴트입니다.\n"
            "- 수업 자료 제작, 평가 문항 출제, 학생 상담 보조, 생기부 작성 보조 등을 돕습니다.\n"
            "- 교육과정(2022 개정) 맥락을 이해하고 답변합니다.\n"
            "- 사용자가 모호하게 물으면 의도를 확인하는 짧은 질문을 먼저 합니다.\n"
            "- 답변은 한국어로, 간결하고 실용적으로 작성합니다."
        ),
    },
    {
        "name": "교사용 - 평가 문항 출제",
        "audience": "teacher",
        "sort_order": 5,
        "content": (
            "당신은 평가 문항 출제 전문가입니다. 사용자가 단원/성취기준/난이도를 주면 "
            "선다형/서술형 문항을 학생 수준에 맞게 작성합니다. 정답·해설·교육과정 매핑까지 함께 제공합니다."
        ),
    },
    {
        "name": "학생용 기본",
        "audience": "student",
        "is_default": True,
        "sort_order": 1,
        "content": (
            "당신은 한국 고등학생의 학습을 돕는 AI 튜터입니다.\n"
            "지켜야 할 원칙:\n"
            "- 시험 문제의 직접 답을 알려주지 마세요. 대신 풀이 방법, 개념, 힌트를 안내합니다.\n"
            "- 욕설/혐오/위험 행동/도덕적 위반 요청은 정중히 거절합니다.\n"
            "- 학교 폭력, 자해 등 위험 신호가 감지되면 즉시 학교 상담교사와 상의하도록 안내합니다.\n"
            "- 진로/대학·학과 관련 질문은 한국 입시 맥락에서 객관적 정보를 제공합니다.\n"
            "- 한국어로, 친근하고 격려하는 어조로 답합니다."
        ),
    },
    {
        "name": "학생용 - 수학 풀이 도우미",
        "audience": "student",
        "sort_order": 5,
        "content": (
            "당신은 수학 풀이 튜터입니다. 학생이 문제를 가져오면 "
            "1) 무엇을 묻는지 정리, 2) 핵심 개념 안내, 3) 풀이 단계를 한 단계씩 제시 (한 단계 끝에서 학생이 따라왔는지 확인 질문). "
            "최종 답은 학생이 직접 도달하도록 돕습니다."
        ),
    },
]


DEFAULT_CONFIG = {
    "default_provider_teacher": "anthropic",
    "default_model_teacher": "claude-sonnet-4-6",
    "default_provider_student": "anthropic",
    "default_model_student": "claude-haiku-4-5-20251001",
    "student_can_change_model": "false",
    "teacher_can_change_model": "true",
    "student_can_pick_prompt": "false",
    "max_message_length": "8000",
    "max_session_messages": "200",
}


# 챗봇 + 학생 자기 영역 권한을 자동 부여할 역할 (앱이 처음 시드될 때만 1회)
# 기존 환경에도 누적 적용됨 (이미 부여된 건 건너뜀)
DEFAULT_ROLE_GRANTS = {
    "teacher": ["chatbot.use", "chatbot.session.view_own", "chatbot.session.delete_own"],
    "staff": ["chatbot.use", "chatbot.session.view_own", "chatbot.session.delete_own"],
    "student": [
        "chatbot.use", "chatbot.session.view_own", "chatbot.session.delete_own",
        # 학생 본인 영역
        "student.artifact.manage", "student.artifact.view_public",
        "student.career.manage", "student.research.browse",
    ],
}


async def seed_chatbot_defaults(db: AsyncSession) -> None:
    from app.models.permission import Permission, RolePermission

    # 0) 챗봇 권한을 역할에 기본 부여 (이미 부여된 건 건너뜀)
    added_grants = 0
    for role, keys in DEFAULT_ROLE_GRANTS.items():
        for key in keys:
            perm = (await db.execute(select(Permission).where(Permission.key == key))).scalar_one_or_none()
            if not perm:
                continue
            existing = (await db.execute(
                select(RolePermission).where(
                    RolePermission.role == role,
                    RolePermission.permission_id == perm.id,
                )
            )).scalar_one_or_none()
            if not existing:
                db.add(RolePermission(role=role, permission_id=perm.id, granted_by=None))
                added_grants += 1

    # 1) 모델 가격
    existing_models = (await db.execute(select(LLMModel))).scalars().all()
    existing_keys = {(m.provider, m.model_id) for m in existing_models}
    added_models = 0
    for prov, mid, disp, in_p, out_p, ctx, order in DEFAULT_MODELS:
        if (prov, mid) not in existing_keys:
            db.add(LLMModel(
                provider=prov, model_id=mid, display_name=disp,
                input_per_1m_usd=in_p, output_per_1m_usd=out_p,
                context_window=ctx, sort_order=order, is_active=True,
            ))
            added_models += 1

    # 2) 시스템 프롬프트 — 같은 name이 없으면 추가
    existing_prompt_names = {p.name for p in (await db.execute(select(SystemPrompt))).scalars().all()}
    added_prompts = 0
    for pdef in DEFAULT_PROMPTS:
        if pdef["name"] not in existing_prompt_names:
            db.add(SystemPrompt(
                name=pdef["name"], audience=pdef["audience"], content=pdef["content"],
                is_default=pdef.get("is_default", False), is_active=True,
                sort_order=pdef.get("sort_order", 100),
            ))
            added_prompts += 1

    # 3) 전역 설정
    existing_cfg = {c.key for c in (await db.execute(select(ChatbotConfig))).scalars().all()}
    added_cfg = 0
    for k, v in DEFAULT_CONFIG.items():
        if k not in existing_cfg:
            db.add(ChatbotConfig(key=k, value=v))
            added_cfg += 1

    await db.flush()
    if added_models or added_prompts or added_cfg or added_grants:
        print(f"[SEED] chatbot: 권한부여 +{added_grants}, 모델 +{added_models}, 프롬프트 +{added_prompts}, 설정 +{added_cfg}")
    else:
        print(f"[SEED] chatbot: 최신 상태")
