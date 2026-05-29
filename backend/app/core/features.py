"""Feature Flag 헬퍼.

학교별로 기능 ON/OFF — 모든 코드는 한 main에, 학교가 활성 기능 결정.

설계:
  - FeatureFlag.status: "off" | "admin_only" | "on"
  - off: 누구도 접근 불가 (메뉴 숨김, API 403/404)
  - admin_only: super_admin/designated_admin만 (학교에서 테스트 중)
  - on: 모두 접근 가능

부팅 시 KNOWN_FEATURES에 정의된 flag들이 DB에 자동 시드 (없으면 기본 status="off"로).
새 기능 추가 시:
  1. KNOWN_FEATURES에 등록 (key, label, category, default_status)
  2. 라우터/컴포넌트에 `is_feature_enabled` 가드
  3. 사이드바 메뉴는 feature_key를 attribute에
"""

from __future__ import annotations

import logging
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import FeatureFlag
from app.models.user import User

log = logging.getLogger(__name__)


# 알려진 기능 카탈로그 — 부팅 시 자동 시드 + UI 표시용
# (key, label, category, default_status, description)
KNOWN_FEATURES: list[dict] = [
    # ── 코어 (보통 항상 ON) ──
    {"key": "users", "label": "사용자 관리", "category": "코어",
     "default_status": "on", "description": "사용자 CRUD, 권한, 일괄 등록"},
    {"key": "classroom", "label": "클래스룸 (강좌)", "category": "코어",
     "default_status": "on", "description": "강좌·학급 단위 게시판"},
    {"key": "students_portfolio", "label": "학생 포트폴리오", "category": "코어",
     "default_status": "on", "description": "성적·수상·생기부 누적 관리"},

    # ── 학습 도구 ──
    {"key": "chatbot", "label": "AI 챗봇", "category": "학습 도구",
     "default_status": "off", "description": "교사/학생용 Claude/GPT 챗봇 (API 키 필요)"},
    {"key": "courseware", "label": "문제 코스웨어", "category": "학습 도구",
     "default_status": "off", "description": "자동채점 문제 출제·풀이"},
    {"key": "papers", "label": "논문 분석", "category": "학습 도구",
     "default_status": "off", "description": "arXiv 논문 키워드 알림"},

    # ── 활동 ──
    {"key": "contest", "label": "대회/올림피아드", "category": "활동",
     "default_status": "off", "description": "대회 등록, 신청, 결과 관리"},
    {"key": "club", "label": "동아리", "category": "활동",
     "default_status": "off", "description": "동아리 등록, 활동 기록, 일괄 배정"},
    {"key": "research", "label": "연구·논문", "category": "활동",
     "default_status": "off", "description": "학생 연구 프로젝트, 담당 교사"},
    {"key": "challenge", "label": "도전 과제", "category": "활동",
     "default_status": "off", "description": "교사 출제 챌린지"},

    # ── 진로 ──
    {"key": "admissions", "label": "대학 입학 분석", "category": "진로",
     "default_status": "off", "description": "전국 대학교 입학요강 검색"},
    {"key": "career_plan", "label": "진로 설계", "category": "진로",
     "default_status": "off", "description": "학기 단위 진로 계획"},

    # ── 운영 ──
    {"key": "timetable", "label": "시간표", "category": "운영",
     "default_status": "off", "description": "교사 시간표, 개인 일정"},
    {"key": "meeting", "label": "회의·협의록", "category": "운영",
     "default_status": "off", "description": "협의록 작성/공유"},
    {"key": "announcement", "label": "공지사항", "category": "운영",
     "default_status": "on", "description": "전체/직원/학생 공지"},
    {"key": "feedback", "label": "건의/오류 보고", "category": "운영",
     "default_status": "on", "description": "사용자 → 관리자 피드백"},

    # ── 시스템 ──
    {"key": "ai_developer", "label": "AI 개발자", "category": "시스템",
     "default_status": "off",
     "description": "운영 초기 3개월 OFF 권장 (GitHub 충돌 회피)"},
    {"key": "google_integration", "label": "Google Drive 연동", "category": "시스템",
     "default_status": "off", "description": "OAuth Google Drive 백업"},
]

FeatureStatus = Literal["off", "admin_only", "on"]


async def seed_known_features(db: AsyncSession) -> int:
    """부팅 시 호출. KNOWN_FEATURES 중 DB에 없는 거 추가.

    Returns:
        새로 추가된 flag 수.
    """
    existing_keys = set(
        (await db.execute(select(FeatureFlag.key))).scalars().all()
    )
    added = 0
    for feat in KNOWN_FEATURES:
        if feat["key"] in existing_keys:
            continue
        db.add(FeatureFlag(
            key=feat["key"], status=feat["default_status"],
        ))
        added += 1
    if added:
        await db.flush()
        log.info("seed_known_features: added %d new flags", added)
    return added


async def is_feature_enabled(
    db: AsyncSession, key: str, user: User | None = None,
) -> bool:
    """기능 활성 여부.

    - status="off": False
    - status="on": True
    - status="admin_only": super_admin/designated_admin만 True
    - DB에 없는 키: False (안전한 기본값)
    """
    flag = (await db.execute(
        select(FeatureFlag).where(FeatureFlag.key == key)
    )).scalar_one_or_none()
    if not flag:
        log.warning("is_feature_enabled: unknown key '%s' (treating as off)", key)
        return False
    if flag.status == "on":
        return True
    if flag.status == "off":
        return False
    if flag.status == "admin_only":
        return bool(user and user.role in ("super_admin", "designated_admin"))
    return False


async def get_effective_features(
    db: AsyncSession, user: User | None = None,
) -> dict[str, bool]:
    """현재 사용자에게 보이는 모든 기능의 bool dict.

    Frontend가 한 번 호출해서 features 상태 캐시.
    """
    all_flags = (await db.execute(select(FeatureFlag))).scalars().all()
    out: dict[str, bool] = {}
    for f in all_flags:
        if f.status == "on":
            out[f.key] = True
        elif f.status == "off":
            out[f.key] = False
        elif f.status == "admin_only":
            out[f.key] = bool(user and user.role in ("super_admin", "designated_admin"))
        else:
            out[f.key] = False
    return out


async def list_all_features_with_meta(db: AsyncSession) -> list[dict]:
    """관리자 UI용 — 모든 flag + KNOWN_FEATURES 메타 + 현재 status.

    KNOWN_FEATURES에만 있고 DB에 없는 건 default_status로 표시 (시드 전).
    DB에만 있고 KNOWN에 없는 건 'custom'으로 표시.
    """
    db_flags = {
        f.key: f for f in (await db.execute(select(FeatureFlag))).scalars().all()
    }
    out = []
    known_keys = set()
    for feat in KNOWN_FEATURES:
        k = feat["key"]
        known_keys.add(k)
        db_flag = db_flags.get(k)
        out.append({
            "key": k,
            "label": feat["label"],
            "category": feat["category"],
            "description": feat["description"],
            "default_status": feat["default_status"],
            "status": db_flag.status if db_flag else feat["default_status"],
            "updated_at": db_flag.updated_at.isoformat() if db_flag else None,
        })
    # custom flag (코드에 없는 거)
    for k, f in db_flags.items():
        if k in known_keys:
            continue
        out.append({
            "key": k,
            "label": k,
            "category": "Custom (코드에 등록 안 됨)",
            "description": "KNOWN_FEATURES에 없는 flag",
            "default_status": "off",
            "status": f.status,
            "updated_at": f.updated_at.isoformat(),
        })
    return out


async def set_feature_status(
    db: AsyncSession, key: str, status: FeatureStatus, user_id: int | None = None,
) -> FeatureFlag:
    """flag status 변경. 없으면 생성."""
    if status not in ("off", "admin_only", "on"):
        raise ValueError(f"invalid status: {status}")

    flag = (await db.execute(
        select(FeatureFlag).where(FeatureFlag.key == key)
    )).scalar_one_or_none()
    if flag:
        flag.status = status
        flag.updated_by = user_id
    else:
        flag = FeatureFlag(key=key, status=status, updated_by=user_id)
        db.add(flag)
    await db.flush()
    return flag
