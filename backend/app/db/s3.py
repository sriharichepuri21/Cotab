"""Object storage: S3 (boto3) with automatic local-filesystem fallback.

Falls back to ./local_data/objects when LocalStack/S3 is unreachable so the
dev experience works end-to-end with zero external services.
"""

import io as _io_module
import os
import uuid
from pathlib import Path
from typing import BinaryIO

from app.config.settings import get_settings

settings = get_settings()

LOCAL_STORE = Path("./local_data/objects")


class LocalStore:
    """Filesystem drop-in for the S3 operations we actually use."""

    def __init__(self, root: Path = LOCAL_STORE):
        self.root = root

    def _path(self, key: str) -> Path:
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def upload(self, key: str, data: BinaryIO) -> None:
        with open(self._path(key), "wb") as f:
            f.write(data.read())

    def download_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def presign(self, key: str) -> str:
        # Local dev: not a real URL, but a stable pointer the frontend can use
        return f"local://{key}"


_local = LocalStore()


def get_s3_client():
    import boto3
    from botocore.config import Config

    kwargs = {
        "service_name": "s3",
        "region_name": settings.aws_default_region,
        "aws_access_key_id": settings.aws_access_key_id,
        "aws_secret_access_key": settings.aws_secret_access_key,
        "config": Config(signature_version="s3v4"),
    }
    if settings.s3_endpoint_url:
        kwargs["endpoint_url"] = settings.s3_endpoint_url
    return boto3.client(**kwargs)


def ensure_bucket_exists() -> None:
    s3 = get_s3_client()
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except Exception:
        s3.create_bucket(Bucket=settings.s3_bucket)


def generate_upload_path(user_id: str, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower() or ".webp"
    return f"uploads/{user_id}/{uuid.uuid4()}{ext}"


def upload_file(key: str, data: BinaryIO, content_type: str) -> None:
    # Buffer to bytes first so the caller's stream isn't left in a broken
    # state if S3 is reachable but errors mid-upload.
    if hasattr(data, "read"):
        payload = data.read()
    else:
        payload = data
    try:
        s3 = get_s3_client()
        import io as _io

        s3.upload_fileobj(
            _io.BytesIO(payload),
            settings.s3_bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    except Exception:
        _local.upload(key, _io.BytesIO(payload))


def download_bytes(key: str) -> bytes:
    try:
        s3 = get_s3_client()
        return s3.get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()
    except Exception:
        return _local.download_bytes(key)


def presign_download_url(key: str, expires_seconds: int = 7 * 24 * 3600) -> str:
    try:
        s3 = get_s3_client()
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": key},
            ExpiresIn=expires_seconds,
        )
    except Exception:
        return _local.presign(key)
