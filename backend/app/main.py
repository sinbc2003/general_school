"""General School 통합 플랫폼 - FastAPI 엔트리포인트"""

import sys
# Windows 콘솔(cp949)에서 한글/유니코드 문자 인쇄 안전하게
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.database import init_db, async_session_factory
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 권한 일관성 검증 — 라우터 require_permission 키 vs 모듈 permissions.py 정의
    # 이 시점에는 모든 라우터가 import 완료라 _REGISTERED_KEYS가 채워진 상태.
    from app.core.permission_registry import (
        collect_defined_permissions,
        validate_permission_coverage,
    )
    defined = collect_defined_permissions()
    validate_permission_coverage(defined)  # 누락 시 RuntimeError → 부팅 실패

    # DB 초기화 + 시드 (수집된 정의를 그대로 시드)
    await init_db()
    async with async_session_factory() as db:
        from scripts.seed import seed_super_admin, seed_permissions, seed_default_semester
        from scripts.seed_chatbot import seed_chatbot_defaults
        await seed_super_admin(db)
        await seed_permissions(db, defined)
        await seed_chatbot_defaults(db)
        await seed_default_semester(db)
        await db.commit()
    yield


app = FastAPI(
    title=f"{settings.SCHOOL_NAME} 통합 플랫폼",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static Files ──
import os
storage_path = os.path.join(os.path.dirname(__file__), "..", "storage")
os.makedirs(storage_path, exist_ok=True)  # 없으면 생성 (브랜딩 favicon 등에 필수)
app.mount("/storage", StaticFiles(directory=storage_path), name="storage")

# ── 라우터 등록 ──
from app.modules.auth.router import router as auth_router
from app.modules.users.router import router as users_router
from app.modules.permissions.router import router as permissions_router
from app.modules.system.router import router as system_router
from app.modules.archive.router import router as archive_router
from app.modules.pipeline.router import router as pipeline_router
from app.modules.contest.router import router as contest_router
from app.modules.assignment.router import router as assignment_router
from app.modules.meeting.router import router as meeting_router
from app.modules.papers.router import router as papers_router
from app.modules.timetable.router import router as timetable_router
from app.modules.research.router import router as research_router
from app.modules.club.router import router as club_router
from app.modules.admissions.router import router as admissions_router
from app.modules.portfolio.router import router as portfolio_router
from app.modules.challenge.router import router as challenge_router
from app.modules.community.router import router as community_router
from app.modules.feedback.router import router as feedback_router
from app.modules.ai_developer.router import router as ai_developer_router
from app.modules.chatbot.router import router as chatbot_router
from app.modules.student_self.router import router as student_self_router

# Phase 1: 핵심 인프라
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(permissions_router)
app.include_router(system_router)

# Phase 2: 콘텐츠 모듈
app.include_router(archive_router)
app.include_router(pipeline_router)
app.include_router(contest_router)
app.include_router(assignment_router)
app.include_router(meeting_router)
app.include_router(papers_router)
app.include_router(timetable_router)
app.include_router(research_router)
app.include_router(club_router)
app.include_router(admissions_router)
app.include_router(portfolio_router)
app.include_router(challenge_router)
app.include_router(community_router)
app.include_router(feedback_router)
app.include_router(ai_developer_router)
app.include_router(chatbot_router)
app.include_router(student_self_router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "school": settings.SCHOOL_NAME,
        "version": "1.0.0",
    }
