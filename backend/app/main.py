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
    import asyncio as _asyncio
    # 보안 키 검증 (ENV=production이면 디폴트값 사용 시 부팅 차단)
    from app.core.security_checks import check_production_secrets
    check_production_secrets()

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
        from scripts.seed_positions import seed_default_position_templates
        await seed_super_admin(db)
        await seed_permissions(db, defined)
        await seed_chatbot_defaults(db)
        await seed_default_semester(db)
        await seed_default_position_templates(db)  # 권한 시드 후 (perm 키 검증 필요)
        # role-permission 기본값 자동 부여 (멱등 — 이미 부여된 권한은 skip).
        # 새 모듈/권한 추가 시 backend 재시작만으로 teacher/staff/student에 자동 반영.
        try:
            from scripts.grant_default_roles import (
                grant_for_role,
                STAFF_KEYS, STUDENT_KEYS,
                TEACHER_EXCLUDE_PREFIXES, TEACHER_EXCLUDE_KEYS, TEACHER_INCLUDE_KEYS,
            )
            from sqlalchemy import select as _select
            from app.models.permission import Permission as _Perm
            all_keys = set((await db.execute(_select(_Perm.key))).scalars().all())
            teacher_keys = {
                k for k in all_keys
                if not k.startswith(TEACHER_EXCLUDE_PREFIXES) and k not in TEACHER_EXCLUDE_KEYS
            } | (TEACHER_INCLUDE_KEYS & all_keys)
            await grant_for_role(db, "teacher", teacher_keys)
            await grant_for_role(db, "staff", STAFF_KEYS)
            await grant_for_role(db, "student", STUDENT_KEYS)
        except Exception as e:
            print(f"[WARN] auto-grant default roles 실패 (수동 실행 가능): {e}")
        await db.commit()

    # 자동 백업 스케줄러 시작 (백그라운드 task)
    from app.core.backup_scheduler import start_scheduler as start_backup
    bg_backup_task = start_backup()

    # 알림 스케줄러 (과제 마감 임박 reminder) — 1시간마다 tick
    from app.core.notification_scheduler import start_scheduler as start_notif
    bg_notif_task = start_notif()

    try:
        yield
    finally:
        for task, name in [(bg_backup_task, "backup"), (bg_notif_task, "notif")]:
            task.cancel()
            try:
                await task
            except _asyncio.CancelledError:
                pass
            except Exception as e:
                print(f"[WARN] {name} scheduler shutdown error: {e}")


app = FastAPI(
    title=f"{settings.SCHOOL_NAME} 통합 플랫폼",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

# ── CORS ──
# 환경변수 CORS_ALLOW_ORIGINS (콤마 구분). production은 학교 도메인만 허용.
_cors_origins = [o.strip() for o in (settings.CORS_ALLOW_ORIGINS or "").split(",") if o.strip()]
if not _cors_origins:
    _cors_origins = ["http://localhost:3000"]  # 최소 fallback
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static Files ──
# 보안: /storage 전체 노출 금지. 학생 산출물·과제 제출물·백업 ZIP이
# 익명으로 다운로드되는 사고 방지. 인증·visibility 가드 통과한 endpoint
# (예: /api/storage/artifacts/{aid}/download)만 파일 서빙.
#
# 예외: /storage/branding/* 는 layout SSR에서 익명 favicon 호출이 필요.
import os
storage_path = os.path.join(os.path.dirname(__file__), "..", "storage")
os.makedirs(storage_path, exist_ok=True)
branding_path = os.path.join(storage_path, "branding")
os.makedirs(branding_path, exist_ok=True)
app.mount("/storage/branding", StaticFiles(directory=branding_path), name="branding")

# ── 라우터 등록 ──
from app.modules.auth.router import router as auth_router
from app.modules.users.router import router as users_router
from app.modules.permissions.router import router as permissions_router
from app.modules.system.router import router as system_router
from app.modules.archive.router import router as archive_router
from app.modules.pipeline.router import router as pipeline_router
from app.modules.contest.router import router as contest_router
from app.modules.assignment.router import router as assignment_router
from app.modules.papers.router import router as papers_router
from app.modules.timetable.router import router as timetable_router
from app.modules.research.router import router as research_router
from app.modules.club.router import router as club_router
from app.modules.admissions.router import router as admissions_router
from app.modules.portfolio.router import router as portfolio_router
from app.modules.challenge.router import router as challenge_router
from app.modules.feedback.router import router as feedback_router
from app.modules.ai_developer.router import router as ai_developer_router
from app.modules.chatbot.router import router as chatbot_router
from app.modules.student_self.router import router as student_self_router
from app.modules.announcement.router import router as announcement_router
from app.modules.files.router import router as files_router
from app.modules.classroom.router import router as classroom_router
from app.modules.classroom_docs.router import router as classroom_docs_router
from app.modules.classroom_slides.router import router as classroom_slides_router
from app.modules.embeds.router import router as embeds_router
from app.modules.classroom_surveys.router import router as classroom_surveys_router
from app.modules.classroom_links.router import (
    router as classroom_links_router,
    public_router as classroom_links_public_router,
)
from app.modules.notifications.router import router as notifications_router
from app.modules.classroom_sheets.router import router as classroom_sheets_router
from app.modules.drive.router import router as drive_router

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
app.include_router(papers_router)
app.include_router(timetable_router)
app.include_router(research_router)
app.include_router(club_router)
app.include_router(admissions_router)
app.include_router(portfolio_router)
app.include_router(challenge_router)
app.include_router(feedback_router)
app.include_router(ai_developer_router)
app.include_router(chatbot_router)
app.include_router(student_self_router)
app.include_router(announcement_router)
app.include_router(files_router)
app.include_router(classroom_router)
app.include_router(classroom_docs_router)
app.include_router(classroom_slides_router)
app.include_router(embeds_router)
app.include_router(classroom_surveys_router)
app.include_router(classroom_links_router)
app.include_router(classroom_links_public_router)
app.include_router(notifications_router)
app.include_router(classroom_sheets_router)
app.include_router(drive_router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "school": settings.SCHOOL_NAME,
        "version": "1.0.0",
    }
