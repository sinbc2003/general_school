"""생기부 검증 — NEIS 금지항목 스캔 + 글자수/바이트수 집계.

작성 매트릭스에는 글자수·바이트수·유사도를 인라인으로 표시(검증 통합),
NEIS 금지항목 검사는 별도 탭에서 이 엔드포인트로 일괄 스캔한다.

대상: 각 셀의 generated_text(없으면 raw_data 아님 — 생성문만). 휴리스틱이라
'high'(거의 확실히 금지) / 'review'(검토 필요)로 구분해 교사가 최종 판단.

NEIS 기재요령 주요 금지: 어학인증시험, 특정 대학·기관명, 교외 수상·대회,
부모·가족의 사회경제적 지위, 공인 자격증, 특정 상호·브랜드.
"""

import re

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProjectStudent,
)
from app.models.user import User
from app.modules.record_writer._helpers import get_owned_project
from app.modules.record_writer.router import router


def neis_byte_len(text: str | None) -> int:
    """NEIS 바이트 수 — UTF-8 기준 (한글 3바이트, 영문·숫자·공백 1바이트)."""
    return len((text or "").encode("utf-8"))


# (key, 라벨, 심각도, 정규식) — 휴리스틱. severity: high(거의 금지) / review(검토 필요)
_NEIS_RULES: list[tuple[str, str, str, "re.Pattern[str]"]] = [
    ("language_test", "어학인증시험", "high",
     re.compile(r"TOEIC|TOEFL|TEPS|TOSEL|토익|토플|텝스|IELTS|아이엘츠|HSK|JLPT|JPT")),
    ("university", "특정 대학·기관명", "high",
     re.compile(r"[가-힣]{2,}대학교|서울대|연세대|고려대|서강대|성균관대|한양대|중앙대|경희대|"
                r"KAIST|카이스트|POSTECH|포스텍|UNIST|유니스트|GIST|지스트|DGIST")),
    ("award", "교외 수상·대회", "review",
     re.compile(r"수상|입상|장려상|우수상|최우수상|대상\s*수상|금상|은상|동상|장원|"
                r"올림피아드|경시대회|공모전")),
    ("family", "부모·가족 정보", "high",
     re.compile(r"아버지|어머니|부모님|학부모|부친|모친|가정형편|집안 형편|조부|조모")),
    ("certificate", "공인 자격증·인증", "review",
     re.compile(r"자격증|기능사|기사 자격|민간자격|공인\s*인증")),
    ("brand", "특정 상호·브랜드", "review",
     re.compile(r"삼성전자|LG전자|현대자동차|네이버|카카오|구글|애플|마이크로소프트")),
]


def scan_neis(text: str | None) -> list[dict]:
    """텍스트에서 NEIS 금지항목 후보 탐지 → [{key, label, severity, terms}]."""
    if not text:
        return []
    out = []
    for key, label, sev, pat in _NEIS_RULES:
        found = pat.findall(text)
        if found:
            # 중복 제거 + 빈 매치 제거
            terms = sorted({m for m in found if m})
            if terms:
                out.append({"key": key, "label": label, "severity": sev, "terms": terms})
    return out


@router.get("/projects/{pid}/neis-check")
async def neis_check(
    pid: int,
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 전체 셀의 NEIS 금지항목 + 글자수/바이트 위반을 일괄 스캔.

    반환: {items: [...위반 셀...], summary: {...}}
    위반이 없는 셀은 items에서 제외 (탭에서 문제 있는 것만 보이게).
    """
    p = await get_owned_project(db, user, pid)

    # 학생 이름 + 항목 메타
    names = dict(
        (await db.execute(
            select(RecordProjectStudent.student_id, User.name)
            .join(User, User.id == RecordProjectStudent.student_id)
            .where(RecordProjectStudent.project_id == pid)
        )).all()
    )
    cols = {
        c.id: c
        for c in (await db.execute(
            select(RecordColumn).where(RecordColumn.project_id == pid)
        )).scalars().all()
    }
    cells = (await db.execute(
        select(RecordCell).where(RecordCell.project_id == pid)
    )).scalars().all()

    items: list[dict] = []
    sev_count = {"high": 0, "review": 0}
    over_count = 0
    for cell in cells:
        text = cell.generated_text
        if not text:
            continue
        col = cols.get(cell.column_id)
        char_count = len(text)
        byte_count = neis_byte_len(text)
        char_max = col.char_max if col else None
        over_char = bool(char_max and char_count > char_max)
        findings = scan_neis(text)
        if not findings and not over_char:
            continue
        for f in findings:
            sev_count[f["severity"]] = sev_count.get(f["severity"], 0) + 1
        if over_char:
            over_count += 1
        items.append({
            "column_id": cell.column_id,
            "column_name": col.name if col else "",
            "student_id": cell.student_id,
            "student_name": names.get(cell.student_id, ""),
            "char_count": char_count,
            "byte_count": byte_count,
            "char_max": char_max,
            "over_char": over_char,
            "findings": findings,
            "excerpt": text[:120],
        })

    # high 위반 먼저 → 학생 이름 순
    items.sort(key=lambda x: (
        0 if any(f["severity"] == "high" for f in x["findings"]) else 1,
        x["student_name"],
    ))
    return {
        "items": items,
        "summary": {
            "flagged_cells": len(items),
            "high": sev_count["high"],
            "review": sev_count["review"],
            "over_char": over_count,
            "total_cells": len([c for c in cells if c.generated_text]),
        },
    }
