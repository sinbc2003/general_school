"""신뢰 장치 관리 endpoints (본인 자기 장치).

router 객체는 router.py에서 공유.
"""

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user, verify_password
from app.core.database import get_db
from app.models.device import TrustedDevice
from app.models.user import User

from app.modules.auth.router import router



@router.get("/trusted-devices")
async def list_my_trusted_devices(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인의 신뢰 장치 목록. 현재 사용 중인 장치는 'current'=True."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(TrustedDevice)
        .where(TrustedDevice.user_id == user.id, TrustedDevice.expires_at > now)
        .order_by(TrustedDevice.last_used_at.desc().nullslast(), TrustedDevice.created_at.desc())
    )).scalars().all()

    current_token = request.cookies.get("device_token")
    items = []
    for d in rows:
        is_current = bool(current_token and verify_password(current_token, d.token_hash))
        items.append({
            "id": d.id,
            "label": d.label,
            "ip_address": d.ip_address,
            "last_used_at": d.last_used_at.isoformat() if d.last_used_at else None,
            "expires_at": d.expires_at.isoformat() if d.expires_at else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "current": is_current,
        })
    return {"items": items}


@router.delete("/trusted-devices/{device_id}")
async def revoke_my_trusted_device(
    device_id: int, request: Request, response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인 신뢰 장치 취소. 현재 장치를 취소하면 cookie도 삭제."""
    d = (await db.execute(
        select(TrustedDevice).where(
            TrustedDevice.id == device_id, TrustedDevice.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "장치 없음")

    current_token = request.cookies.get("device_token")
    is_current = bool(current_token and verify_password(current_token, d.token_hash))

    await db.delete(d)
    await db.flush()
    if is_current:
        response.delete_cookie("device_token", path="/")
    await log_action(
        db, user, "device.trusted_revoked",
        target=f"id:{device_id} current:{is_current}", request=request,
    )
    return {"ok": True}


@router.delete("/trusted-devices")
async def revoke_all_my_trusted_devices(
    request: Request, response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인의 모든 신뢰 장치 일괄 취소. 보안 사고 의심 시 즉시 대응."""
    from sqlalchemy import delete as sql_delete
    result = await db.execute(
        sql_delete(TrustedDevice).where(TrustedDevice.user_id == user.id)
    )
    count = result.rowcount or 0
    response.delete_cookie("device_token", path="/")
    await log_action(
        db, user, "device.trusted_revoked_all",
        target=f"count:{count}", request=request, is_sensitive=True,
    )
    return {"ok": True, "revoked": count}
