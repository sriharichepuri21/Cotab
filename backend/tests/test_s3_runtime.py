import io

import pytest

from app.db import s3


class BrokenS3:
    def upload_fileobj(self, *_args, **_kwargs):
        raise OSError("offline")


def test_production_upload_never_falls_back_to_ephemeral_disk(monkeypatch):
    monkeypatch.setattr(s3.settings, "environment", "production")
    monkeypatch.setattr(s3, "get_s3_client", lambda: BrokenS3())
    monkeypatch.setattr(
        s3._local, "upload", lambda *_args: pytest.fail("local fallback used")
    )

    with pytest.raises(RuntimeError, match="object storage upload failed"):
        s3.upload_file("uploads/u/r.jpg", io.BytesIO(b"receipt"), "image/jpeg")


def test_development_upload_keeps_zero_setup_fallback(monkeypatch, tmp_path):
    monkeypatch.setattr(s3.settings, "environment", "development")
    monkeypatch.setattr(s3, "get_s3_client", lambda: BrokenS3())
    local = s3.LocalStore(tmp_path)
    monkeypatch.setattr(s3, "_local", local)

    s3.upload_file("uploads/u/r.jpg", io.BytesIO(b"receipt"), "image/jpeg")

    assert local.download_bytes("uploads/u/r.jpg") == b"receipt"
