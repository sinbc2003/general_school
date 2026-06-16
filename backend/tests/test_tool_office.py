"""업무 도구 (PDF→HWPX 변환 / PDF 번역) 테스트.

커버:
  - 잡 생성 가드: Mathpix 미설정 시 400, LLM 미설정 시 400, 비-PDF 400
  - 설정 엔드포인트: admin만 (교사 403), 키 마스킹
  - 잡 IDOR: 타 교사/학생 접근 차단
  - 엔진: parse_mmd → ir_to_hwpx 가 네트워크 없이 유효한 HWPX(zip) 생성 (Linux/COM 없음)
  - 번역 유틸: 청크 분할, 언어 라벨
"""

import io
import zipfile

import pytest
import pytest_asyncio

from tests.conftest import _create_user

pytestmark = pytest.mark.asyncio

_MINI_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


@pytest_asyncio.fixture
async def teacher2(db_session, seed_perms):
    return await _create_user(
        db_session, email="t2office@test.local", name="Teacher Two", role="teacher",
    )


def _files(name="a.pdf", content=_MINI_PDF, ctype="application/pdf"):
    return {"file": (name, content, ctype)}


# ── 잡 생성 가드 ────────────────────────────────────────────

async def test_pdf2hwpx_requires_mathpix(app_client, teacher_user, auth_headers):
    """Mathpix 미설정 → 400 (관리자 설정 안내)."""
    r = await app_client.post(
        "/api/tools/office/pdf2hwpx",
        headers=auth_headers(teacher_user),
        files=_files(),
        data={"mode": "hybrid", "doc_type": "exam", "columns": 1},
    )
    assert r.status_code == 400
    assert "Mathpix" in r.json()["detail"]


async def test_pdf2hwpx_rejects_non_pdf(app_client, super_admin, teacher_user, auth_headers):
    """Mathpix 설정 후에도 비-PDF는 확장자 검증으로 400."""
    # admin이 Mathpix 키 설정
    rc = await app_client.put(
        "/api/tools/office/mathpix-config",
        headers=auth_headers(super_admin),
        json={"app_id": "test_id", "app_key": "test_key_secret_value", "enabled": True},
    )
    assert rc.status_code == 200

    r = await app_client.post(
        "/api/tools/office/pdf2hwpx",
        headers=auth_headers(teacher_user),
        files=_files(name="a.txt", content=b"hello", ctype="text/plain"),
        data={"mode": "hybrid", "doc_type": "exam", "columns": 1},
    )
    assert r.status_code == 400
    assert "확장자" in r.json()["detail"]


async def test_translate_requires_llm(app_client, teacher_user, auth_headers):
    """활성 LLM 없으면 400."""
    r = await app_client.post(
        "/api/tools/office/translate",
        headers=auth_headers(teacher_user),
        files=_files(),
        data={"target_lang": "ko"},
    )
    assert r.status_code == 400
    assert "LLM" in r.json()["detail"]


# ── 설정 권한 ───────────────────────────────────────────────

async def test_config_admin_only(app_client, db_session, teacher_user, super_admin, auth_headers):
    """Mathpix 설정은 admin 전용 (교사 403)."""
    # 403-first 테스트 — 미커밋 fixture가 override 세션 rollback에 지워지지 않게 선커밋
    await db_session.commit()

    r = await app_client.get(
        "/api/tools/office/mathpix-config", headers=auth_headers(teacher_user)
    )
    assert r.status_code == 403

    r2 = await app_client.put(
        "/api/tools/office/mathpix-config",
        headers=auth_headers(teacher_user),
        json={"app_id": "x", "app_key": "y", "enabled": True},
    )
    assert r2.status_code == 403


async def test_config_masks_key(app_client, super_admin, auth_headers):
    """저장한 app_key는 평문 노출 안 됨 (마스킹), app_id는 노출 OK."""
    secret = "mathpix_super_secret_key_123456"
    rc = await app_client.put(
        "/api/tools/office/mathpix-config",
        headers=auth_headers(super_admin),
        json={"app_id": "my_app_id", "app_key": secret, "enabled": True},
    )
    assert rc.status_code == 200

    rg = await app_client.get(
        "/api/tools/office/mathpix-config", headers=auth_headers(super_admin)
    )
    body = rg.json()
    assert body["configured"] is True
    assert body["app_id"] == "my_app_id"
    assert body["enabled"] is True
    assert secret not in body["app_key_preview"]
    assert "*" in body["app_key_preview"]


async def test_status_endpoint(app_client, teacher_user, auth_headers):
    r = await app_client.get("/api/tools/office/status", headers=auth_headers(teacher_user))
    assert r.status_code == 200
    body = r.json()
    assert "mathpix_configured" in body
    assert "llm_configured" in body
    assert "languages" in body and "ko" in body["languages"]


# ── 잡 IDOR ─────────────────────────────────────────────────

async def test_job_idor(app_client, db_session, teacher_user, teacher2, student_user, auth_headers):
    """잡은 소유 교사 본인 + admin만 조회. 타 교사·학생 차단."""
    from app.models.tool_job import ToolJob, ToolJobStatus

    job = ToolJob(
        tool="pdf2hwpx", owner_id=teacher_user.id, title="t",
        status=ToolJobStatus.COMPLETED, progress=100,
        output_file_url="/storage/tool_office/999/output.hwpx",
    )
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)

    # 본인 OK
    r_own = await app_client.get(
        f"/api/tools/office/jobs/{job.id}", headers=auth_headers(teacher_user)
    )
    assert r_own.status_code == 200
    assert r_own.json()["id"] == job.id

    # 타 교사 → 404
    r_other = await app_client.get(
        f"/api/tools/office/jobs/{job.id}", headers=auth_headers(teacher2)
    )
    assert r_other.status_code == 404

    # 학생(tools.office.use 없음) → 403
    r_student = await app_client.get(
        f"/api/tools/office/jobs/{job.id}", headers=auth_headers(student_user)
    )
    assert r_student.status_code == 403


# ── 엔진 (네트워크 없음) ─────────────────────────────────────

async def test_engine_ir_to_hwpx_no_network():
    """parse_mmd → ir_to_hwpx 가 Mathpix/COM 없이 유효한 HWPX(zip) 생성."""
    from app.vendor.pdf2hwpx.packages.core.converter import convert_pdf  # noqa: F401 (sys.path 설정)
    from app.vendor.pdf2hwpx.packages.extractor.mmd_parser import parse_mmd
    from app.vendor.pdf2hwpx.packages.core.pipeline import ir_to_hwpx
    import tempfile, os

    mmd = "# 시험\n\n1. $x^2+2x+1$ 을 인수분해하시오.\n\n2. 답을 쓰시오."
    doc = parse_mmd(mmd, source="t.mmd")
    out = os.path.join(tempfile.mkdtemp(), "t.hwpx")
    ir_to_hwpx(doc, out, columns=1)
    assert os.path.exists(out)
    assert zipfile.is_zipfile(out)
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
    assert any("section0" in n for n in names)
    assert "mimetype" in names


# ── 번역 유틸 ───────────────────────────────────────────────

async def test_translate_chunk_and_labels():
    from app.services.tool_office.translate import chunk_text, lang_label, build_system_prompt

    assert chunk_text("") == []
    assert chunk_text("짧은 문장") == ["짧은 문장"]
    big = "\n\n".join("문단" * 500 for _ in range(10))
    chunks = chunk_text(big, max_chars=1000)
    assert len(chunks) > 1
    assert all(len(c) <= 1200 for c in chunks)  # 약간의 여유 허용

    assert lang_label("ko") == "한국어"
    assert lang_label("zz") == "zz"  # 미지정 코드는 그대로
    sp = build_system_prompt("ko", "en")
    assert "한국어" in sp and "영어" in sp
