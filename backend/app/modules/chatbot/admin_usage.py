"""챗봇 관리자 — 사용량/비용 endpoints.

내 사용량 (개인) + 전체 사용량 (관리자: 일별/모델별/사용자별).
router 객체는 router.py에서 공유. router.py 끝의 'from . import admin_usage'로 등록.
"""

from datetime import date, timedelta

from fastapi import Depends
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.chatbot import ChatUsageDaily
from app.models.user import User

from app.modules.chatbot.router import router


@router.get("/usage/me")
async def my_usage(
    days: int = 30,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """내 최근 N일 사용량"""
    since = date.today() - timedelta(days=days)
    rows = (await db.execute(
        select(ChatUsageDaily).where(
            ChatUsageDaily.user_id == user.id,
            ChatUsageDaily.usage_date >= since,
        ).order_by(ChatUsageDaily.usage_date)
    )).scalars().all()

    total_cost = sum(r.cost_usd for r in rows)
    total_messages = sum(r.message_count for r in rows)
    return {
        "days": days, "total_cost_usd": round(total_cost, 4),
        "total_messages": total_messages,
        "by_day": [
            {
                "date": r.usage_date.isoformat(), "provider": r.provider, "model_id": r.model_id,
                "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
                "cost_usd": round(r.cost_usd, 6), "message_count": r.message_count,
            } for r in rows
        ],
    }


@router.get("/usage/all")
async def all_usage(
    days: int = 30,
    user: User = Depends(require_permission("chatbot.usage.view_all")),
    db: AsyncSession = Depends(get_db),
):
    """관리자: 전체 사용량 (사용자별/일별/모델별 그룹)"""
    since = date.today() - timedelta(days=days)

    # 일별 집계
    by_day_q = await db.execute(
        select(
            ChatUsageDaily.usage_date,
            func.sum(ChatUsageDaily.cost_usd).label("cost"),
            func.sum(ChatUsageDaily.message_count).label("messages"),
        ).where(ChatUsageDaily.usage_date >= since)
        .group_by(ChatUsageDaily.usage_date)
        .order_by(ChatUsageDaily.usage_date)
    )
    by_day = [{"date": r[0].isoformat(), "cost_usd": round(r[1] or 0, 4), "messages": r[2] or 0}
              for r in by_day_q.all()]

    # 모델별
    by_model_q = await db.execute(
        select(
            ChatUsageDaily.provider, ChatUsageDaily.model_id,
            func.sum(ChatUsageDaily.cost_usd).label("cost"),
            func.sum(ChatUsageDaily.input_tokens).label("input"),
            func.sum(ChatUsageDaily.output_tokens).label("output"),
            func.sum(ChatUsageDaily.message_count).label("messages"),
        ).where(ChatUsageDaily.usage_date >= since)
        .group_by(ChatUsageDaily.provider, ChatUsageDaily.model_id)
    )
    by_model = [{
        "provider": r[0], "model_id": r[1], "cost_usd": round(r[2] or 0, 4),
        "input_tokens": r[3] or 0, "output_tokens": r[4] or 0, "messages": r[5] or 0,
    } for r in by_model_q.all()]

    # 사용자별 top
    by_user_q = await db.execute(
        select(
            ChatUsageDaily.user_id, User.username, User.name,
            func.sum(ChatUsageDaily.cost_usd).label("cost"),
            func.sum(ChatUsageDaily.message_count).label("messages"),
        ).join(User, User.id == ChatUsageDaily.user_id)
        .where(ChatUsageDaily.usage_date >= since)
        .group_by(ChatUsageDaily.user_id, User.username, User.name)
        .order_by(desc(func.sum(ChatUsageDaily.cost_usd)))
        .limit(50)
    )
    by_user = [{
        "user_id": r[0], "username": r[1], "name": r[2],
        "cost_usd": round(r[3] or 0, 4), "messages": r[4] or 0,
    } for r in by_user_q.all()]

    total_cost = sum(d["cost_usd"] for d in by_day)
    total_messages = sum(d["messages"] for d in by_day)
    return {
        "days": days,
        "total_cost_usd": round(total_cost, 4),
        "total_messages": total_messages,
        "by_day": by_day, "by_model": by_model, "by_user": by_user,
    }
