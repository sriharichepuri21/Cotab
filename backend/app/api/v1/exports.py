import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.core.security import get_current_user
from app.db import s3 as s3_mod
from app.db.session import get_db
from app.models import ExportRequest, User
from app.schemas.schemas import ExportResponse

settings = get_settings()
router = APIRouter(prefix="/exports", tags=["exports"])


@router.post("", response_model=ExportResponse, include_in_schema=False)
@router.post("/", response_model=ExportResponse)
def request_export(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    req = ExportRequest(user_id=user.id, status="pending")
    db.add(req)
    db.commit()
    db.refresh(req)

    # Synchronous MVP: build immediately (async job w/ Celery in prod)
    import io
    import json

    from app.models import Receipt

    receipts = (
        db.query(Receipt)
        .filter(Receipt.user_id == user.id, Receipt.deleted_at.is_(None))
        .all()
    )
    payload = {
        "user": {
            "id": user.id,
            "email": user.email,
            "phone": user.phone,
            "exported_at": datetime.now(timezone.utc).isoformat(),
        },
        "receipts": [
            {
                "id": r.id,
                "merchant": r.merchant,
                "total": r.total,
                "currency": r.currency,
                "category": r.category,
                "purchased_at": r.purchased_at.isoformat() if r.purchased_at else None,
            }
            for r in receipts
        ],
    }
    key = f"exports/{user.id}/{req.id}.json"
    try:
        body = json.dumps(payload, default=str).encode()
        s3_mod.upload_file(key, io.BytesIO(body), "application/json")
        req.file_key = key
        req.status = "ready"
        req.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    except Exception:
        req.status = "failed"
    db.commit()
    db.refresh(req)

    out = ExportResponse(id=req.id, status=req.status, expires_at=req.expires_at)
    if req.status == "ready" and req.file_key:
        out.download_url = s3_mod.presign_download_url(req.file_key)
    return out


@router.get("", response_model=list[ExportResponse], include_in_schema=False)
@router.get("/", response_model=list[ExportResponse])
def list_exports(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    reqs = (
        db.query(ExportRequest)
        .filter(ExportRequest.user_id == user.id)
        .order_by(ExportRequest.created_at.desc())
        .all()
    )
    out = []
    for r in reqs:
        resp = ExportResponse(id=r.id, status=r.status, expires_at=r.expires_at)
        if r.status == "ready" and r.file_key:
            try:
                resp.download_url = s3_mod.presign_download_url(r.file_key)
            except Exception:
                pass
        out.append(resp)
    return out


def require_cron_secret(x_cron_secret: Optional[str] = Header(default=None)):
    # Constant-time comparison so response timing can't leak the secret
    # one character at a time. An empty configured secret never matches.
    expected = settings.cron_secret.encode()
    provided = (x_cron_secret or "").encode()
    if not expected or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid cron secret")
