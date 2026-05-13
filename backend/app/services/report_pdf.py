"""학생 종합 포트폴리오 PDF - 학교생활기록부 양식 모방

교육부 훈령 제477호 (학교생활기록 작성 및 관리지침) 8개 항목 구성을 따름:
  1. 인적·학적사항
  2. 출결상황
  3. 수상경력
  4. 자격증 및 인증 취득상황
  5. 창의적 체험활동상황 (자율/동아리/봉사/진로)
  6. 교과학습발달상황
  7. 독서활동상황
  8. 행동특성 및 종합의견

데이터 매핑:
- StudentAward: award_type 기반 분기 (예: "certificate" → 자격증, 나머지 → 수상)
- StudentRecord.record_type:
    behavior → 행동특성
    autonomous → 자율활동
    club_activity → 동아리활동
    volunteer → 봉사활동
    career → 진로활동
    reading → 독서활동

한글 폰트: Windows malgun, mac AppleSDGothicNeo, linux NanumGothic 자동 등록.
"""

import io
import os
from collections import defaultdict
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)


_FONT_REGISTERED = False
_FONT_NAME = "Helvetica"
_FONT_NAME_BOLD = "Helvetica-Bold"

# 정부 공문서 풍 컬러
COL_HEADER_BG = colors.HexColor("#2c4a7c")     # 진한 청색 (섹션 헤더)
COL_LABEL_BG = colors.HexColor("#e8eef5")       # 옅은 청색 (라벨 셀)
COL_BORDER = colors.HexColor("#7a8aa5")          # 표 테두리
COL_INNER_BORDER = colors.HexColor("#c5cdd9")  # 내부 셀 구분
COL_TEXT = colors.HexColor("#1a1a1a")
COL_MUTED = colors.HexColor("#666666")


def _register_korean_font() -> tuple[str, str]:
    """플랫폼별 한글 폰트 등록 → (regular, bold) 이름 반환"""
    global _FONT_REGISTERED, _FONT_NAME, _FONT_NAME_BOLD
    if _FONT_REGISTERED:
        return _FONT_NAME, _FONT_NAME_BOLD

    candidates = [
        # Windows
        ("MalgunGothic", "C:/Windows/Fonts/malgun.ttf", "MalgunGothicBold", "C:/Windows/Fonts/malgunbd.ttf"),
        # macOS
        ("AppleGothic", "/System/Library/Fonts/AppleSDGothicNeo.ttc", None, None),
        # Linux
        ("NanumGothic", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
         "NanumGothicBold", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"),
        ("NanumGothic", "/usr/share/fonts/nanum/NanumGothic.ttf",
         "NanumGothicBold", "/usr/share/fonts/nanum/NanumGothicBold.ttf"),
    ]
    for reg_name, reg_path, bold_name, bold_path in candidates:
        if not os.path.exists(reg_path):
            continue
        try:
            pdfmetrics.registerFont(TTFont(reg_name, reg_path))
            _FONT_NAME = reg_name
            if bold_name and bold_path and os.path.exists(bold_path):
                pdfmetrics.registerFont(TTFont(bold_name, bold_path))
                _FONT_NAME_BOLD = bold_name
            else:
                _FONT_NAME_BOLD = reg_name  # bold 없으면 regular 재사용
            _FONT_REGISTERED = True
            return _FONT_NAME, _FONT_NAME_BOLD
        except Exception:
            continue
    _FONT_REGISTERED = True
    return _FONT_NAME, _FONT_NAME_BOLD


def _styles(font: str, font_bold: str):
    base = getSampleStyleSheet()
    return {
        "doc_title": ParagraphStyle(
            "DocTitle", parent=base["Title"], fontName=font_bold, fontSize=16,
            spaceAfter=4, alignment=1, textColor=COL_TEXT,
        ),
        "doc_sub": ParagraphStyle(
            "DocSub", parent=base["Normal"], fontName=font, fontSize=9,
            alignment=1, textColor=COL_MUTED, spaceAfter=14,
        ),
        "section": ParagraphStyle(
            "Section", parent=base["Heading2"], fontName=font_bold, fontSize=11,
            textColor=colors.white, spaceBefore=0, spaceAfter=0,
            leftIndent=4, leading=16,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["Normal"], fontName=font, fontSize=9.5,
            leading=14, spaceAfter=2, textColor=COL_TEXT,
        ),
        "body_sm": ParagraphStyle(
            "BodySmall", parent=base["Normal"], fontName=font, fontSize=8.5,
            leading=12, textColor=COL_TEXT,
        ),
        "label": ParagraphStyle(
            "Label", parent=base["Normal"], fontName=font_bold, fontSize=9,
            alignment=1, textColor=COL_TEXT,
        ),
        "th": ParagraphStyle(
            "TableHeader", parent=base["Normal"], fontName=font_bold, fontSize=9,
            alignment=1, textColor=colors.white,
        ),
        "footer": ParagraphStyle(
            "Footer", parent=base["Normal"], fontName=font, fontSize=8,
            alignment=2, textColor=COL_MUTED,
        ),
        "subgroup": ParagraphStyle(
            "Subgroup", parent=base["Normal"], fontName=font_bold, fontSize=9.5,
            textColor=COL_HEADER_BG, spaceBefore=6, spaceAfter=2,
        ),
    }


def _section_header(text: str, S) -> Table:
    """정부 양식 풍 — 컬러 배경 + 흰색 텍스트"""
    t = Table([[Paragraph(text, S["section"])]], colWidths=[170*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), COL_HEADER_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _kv_table(rows: list[tuple[str, str]], S, font: str, font_bold: str,
              col_widths=(30*mm, 55*mm, 30*mm, 55*mm)):
    """2열 라벨/값 페어를 한 줄에 2쌍 — 정부 양식 인적사항 풍.
    rows가 홀수면 마지막 줄은 1쌍만."""
    data = []
    paired: list[list] = []
    for i in range(0, len(rows), 2):
        row = []
        for j in range(2):
            if i + j < len(rows):
                k, v = rows[i + j]
                row.append(Paragraph(f"<b>{k}</b>", S["label"]))
                row.append(Paragraph(v or "-", S["body_sm"]))
            else:
                row.append("")
                row.append("")
        paired.append(row)

    t = Table(paired, colWidths=col_widths)
    style = [
        ("BACKGROUND", (0, 0), (0, -1), COL_LABEL_BG),
        ("BACKGROUND", (2, 0), (2, -1), COL_LABEL_BG),
        ("BOX", (0, 0), (-1, -1), 0.8, COL_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, COL_INNER_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    t.setStyle(TableStyle(style))
    return t


def _grid_table(headers: list[str], rows: list[list[str]], S, col_widths=None):
    """헤더 + 데이터 그리드"""
    cell_style = S["body_sm"]
    data = [[Paragraph(h, S["th"]) for h in headers]]
    for r in rows:
        data.append([Paragraph(str(c) if c is not None else "-", cell_style) for c in r])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COL_HEADER_BG),
        ("BOX", (0, 0), (-1, -1), 0.8, COL_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, COL_INNER_BORDER),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, COL_BORDER),  # 헤더 아래
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def _empty_note(text: str, S) -> Table:
    """데이터 없음 placeholder (옅은 회색 박스)"""
    t = Table([[Paragraph(text, S["body_sm"])]], colWidths=[170*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f5f5f5")),
        ("BOX", (0, 0), (-1, -1), 0.4, COL_INNER_BORDER),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 0), (-1, -1), COL_MUTED),
    ]))
    return t


def generate_student_pdf(
    student: dict,
    grades: list,
    awards: list,
    mock_exams: list,
    theses: list,
    counselings: list,
    records: list,
    school_name: str = "학교 통합 플랫폼",
    artifacts: list | None = None,
    assignment_submissions: list | None = None,
    club_submissions: list | None = None,
) -> bytes:
    """학생 종합 포트폴리오 PDF 바이트 반환"""
    font, font_bold = _register_korean_font()
    S = _styles(font, font_bold)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=18*mm, bottomMargin=15*mm,
        title=f"{student.get('name', '')} 학생 포트폴리오",
        author=school_name,
    )

    story = []

    # 표지
    story.append(Paragraph("학교생활기록부 (보조자료)", S["doc_title"]))
    story.append(Paragraph(
        f"{school_name}  ·  출력일 {datetime.now().strftime('%Y년 %m월 %d일')}",
        S["doc_sub"],
    ))

    # 1. 인적·학적사항
    story.append(_section_header("1. 인적·학적사항", S))
    story.append(_kv_table([
        ("성명", student.get("name", "")),
        ("학년/반/번호", f"{student.get('grade') or '-'}-{student.get('class_number') or '-'}-{student.get('student_number') or '-'}"),
        ("이메일", student.get("email", "")),
        ("재학 상태", "졸업" if student.get("status") == "graduated" else "재학"),
        ("입학(등록)일", student.get("created_at", "")[:10] if student.get("created_at") else ""),
        ("학교", school_name),
    ], S, font, font_bold))
    story.append(Spacer(1, 5*mm))

    # 2. 출결상황
    story.append(_section_header("2. 출결상황", S))
    story.append(_empty_note("출결 데이터는 NEIS 연동 시 표시됩니다.", S))
    story.append(Spacer(1, 5*mm))

    # 3. 수상경력 (자격증 제외)
    story.append(_section_header("3. 수상경력", S))
    award_rows = [a for a in awards if (a.award_type or "").lower() != "certificate"]
    if award_rows:
        story.append(_grid_table(
            ["수상명", "구분", "등급", "수여기관", "수상일자"],
            [[a.title, a.category, a.award_level, a.organizer or "-",
              a.award_date.isoformat() if a.award_date else ""]
             for a in sorted(award_rows, key=lambda x: x.award_date or datetime(1900, 1, 1).date(), reverse=True)],
            S, col_widths=[55*mm, 25*mm, 25*mm, 35*mm, 30*mm],
        ))
    else:
        story.append(_empty_note("수상 기록 없음", S))
    story.append(Spacer(1, 5*mm))

    # 4. 자격증 및 인증 취득상황
    story.append(_section_header("4. 자격증 및 인증 취득상황", S))
    cert_rows = [a for a in awards if (a.award_type or "").lower() == "certificate"]
    if cert_rows:
        story.append(_grid_table(
            ["자격증명", "분야", "등급/급수", "발급기관", "취득일자"],
            [[a.title, a.category, a.award_level, a.organizer or "-",
              a.award_date.isoformat() if a.award_date else ""]
             for a in sorted(cert_rows, key=lambda x: x.award_date or datetime(1900, 1, 1).date(), reverse=True)],
            S, col_widths=[55*mm, 25*mm, 25*mm, 35*mm, 30*mm],
        ))
    else:
        story.append(_empty_note("자격증 취득 기록 없음 (award_type='certificate'로 등록 시 표시)", S))
    story.append(Spacer(1, 5*mm))

    # 5. 창의적 체험활동상황
    story.append(_section_header("5. 창의적 체험활동상황", S))
    record_groups = defaultdict(list)
    for r in records:
        record_groups[r.record_type].append(r)

    rt_creative = [
        ("autonomous", "자율활동"),
        ("club_activity", "동아리활동"),
        ("volunteer", "봉사활동"),
        ("career", "진로활동"),
    ]
    has_creative = False
    for rt, label in rt_creative:
        if rt in record_groups:
            has_creative = True
            story.append(Paragraph(f"• {label}", S["subgroup"]))
            for r in sorted(record_groups[rt], key=lambda x: (x.year, x.semester)):
                story.append(Paragraph(
                    f"<font color='#666666'>[{r.year}년 {r.semester}학기]</font> {r.content}",
                    S["body"]))
    if not has_creative:
        story.append(_empty_note("기록 없음", S))
    story.append(Spacer(1, 5*mm))

    # 6. 교과학습발달상황
    story.append(_section_header("6. 교과학습발달상황", S))
    if grades:
        by_period = defaultdict(list)
        for g in grades:
            by_period[(g.year, g.semester)].append(g)
        for (year, sem), gs in sorted(by_period.items()):
            story.append(Paragraph(f"• {year}학년도 {sem}학기", S["subgroup"]))
            story.append(_grid_table(
                ["과목", "평가", "원점수/만점", "석차/응시인원", "평균(표준편차)"],
                [[g.subject, "중간" if g.exam_type == "midterm" else ("기말" if g.exam_type == "final" else g.exam_type),
                  f"{g.score}/{g.max_score}",
                  f"{g.grade_rank or '-'}/{g.total_students or '-'}",
                  f"{g.average or '-'}({g.standard_deviation or '-'})"]
                 for g in sorted(gs, key=lambda x: x.subject)],
                S, col_widths=[40*mm, 20*mm, 30*mm, 35*mm, 40*mm],
            ))
            story.append(Spacer(1, 2*mm))
    else:
        story.append(_empty_note("성적 기록 없음", S))

    # 6-1. 모의고사 (부록)
    if mock_exams:
        story.append(Paragraph("• 모의고사 성적 (부록)", S["subgroup"]))
        story.append(_grid_table(
            ["시험명", "시행일", "과목", "원점수", "표준점수", "백분위", "등급"],
            [[m.exam_name, m.exam_date.isoformat() if m.exam_date else "",
              m.subject, m.raw_score, m.standard_score or "-",
              m.percentile or "-", m.grade_level or "-"]
             for m in sorted(mock_exams, key=lambda x: x.exam_date or datetime(1900, 1, 1).date(), reverse=True)],
            S, col_widths=[35*mm, 25*mm, 25*mm, 20*mm, 22*mm, 22*mm, 18*mm],
        ))
    story.append(Spacer(1, 5*mm))

    # 6-2. 논문/연구 활동 (부록)
    if theses:
        story.append(Paragraph("• 논문/연구활동", S["subgroup"]))
        for t in theses:
            story.append(Paragraph(
                f"<b>{t.title}</b>  <font color='#666666'>({t.thesis_type}, {t.status})</font>",
                S["body"]))
            if t.abstract:
                story.append(Paragraph(t.abstract[:500], S["body_sm"]))
            story.append(Spacer(1, 1*mm))
        story.append(Spacer(1, 3*mm))

    # 6-3. 자유 산출물 포트폴리오 (학생 본인이 is_public=True로 공개한 항목만)
    public_artifacts = [a for a in (artifacts or []) if getattr(a, "is_public", False)]
    if public_artifacts:
        story.append(Paragraph("• 산출물 포트폴리오 (학생 본인 등록)", S["subgroup"]))
        story.append(_grid_table(
            ["제목", "분류", "설명/요약", "등록일자"],
            [[a.title, a.category or "-",
              (a.description or "")[:120] + ("…" if a.description and len(a.description) > 120 else ""),
              a.created_at.isoformat()[:10] if a.created_at else ""]
             for a in sorted(public_artifacts, key=lambda x: x.created_at or datetime(1900, 1, 1), reverse=True)],
            S, col_widths=[50*mm, 25*mm, 65*mm, 30*mm],
        ))
        story.append(Spacer(1, 3*mm))

    # 6-4. 과제 제출 활동 (show_in_portfolio=True만 포함)
    visible_subs = [s for s in (assignment_submissions or []) if getattr(s, "show_in_portfolio", False)]
    if visible_subs:
        story.append(Paragraph("• 과제 제출 활동", S["subgroup"]))
        # tuple unpacking 지원: (submission, assignment) 형태로 전달
        rows = []
        for entry in sorted(visible_subs, key=lambda x: x[0].submitted_at if isinstance(x, tuple) and x[0].submitted_at else (x.submitted_at if hasattr(x, "submitted_at") and x.submitted_at else datetime(1900, 1, 1)), reverse=True):
            if isinstance(entry, tuple):
                sub, asn = entry
            else:
                sub = entry
                asn = None
            title = (asn.title if asn else getattr(sub, "assignment_title", "-"))
            subject = (asn.subject if asn else "-")
            status_val = sub.status.value if hasattr(sub.status, "value") else (sub.status or "-")
            rows.append([
                title,
                subject,
                status_val,
                (sub.review_comment or "")[:100] + ("…" if sub.review_comment and len(sub.review_comment) > 100 else ""),
                sub.submitted_at.isoformat()[:10] if sub.submitted_at else "",
            ])
        story.append(_grid_table(
            ["과제명", "교과", "상태", "교사 코멘트", "제출일자"],
            rows, S, col_widths=[45*mm, 22*mm, 20*mm, 55*mm, 28*mm],
        ))
        story.append(Spacer(1, 3*mm))

    # 6-5. 동아리 산출물
    if club_submissions:
        story.append(Paragraph("• 동아리 산출물", S["subgroup"]))
        rows = []
        for entry in sorted(club_submissions, key=lambda x: (x[0].created_at if isinstance(x, tuple) and x[0].created_at else (x.created_at if hasattr(x, "created_at") and x.created_at else datetime(1900, 1, 1))), reverse=True):
            if isinstance(entry, tuple):
                cs, club = entry
            else:
                cs = entry
                club = None
            club_name = (club.name if club else getattr(cs, "club_name", "-"))
            rows.append([
                cs.title,
                club_name,
                cs.submission_type or "-",
                cs.created_at.isoformat()[:10] if cs.created_at else "",
            ])
        story.append(_grid_table(
            ["제목", "동아리", "유형", "등록일자"],
            rows, S, col_widths=[60*mm, 45*mm, 30*mm, 35*mm],
        ))
        story.append(Spacer(1, 3*mm))

    # 7. 독서활동상황
    story.append(_section_header("7. 독서활동상황", S))
    reading_records = sorted(
        record_groups.get("reading", []),
        key=lambda x: (x.year, x.semester),
    )
    if reading_records:
        for r in reading_records:
            story.append(Paragraph(
                f"<font color='#666666'>[{r.year}년 {r.semester}학기]</font> {r.content}",
                S["body"]))
    else:
        story.append(_empty_note("독서 기록 없음 (생기부 탭에서 record_type='reading'으로 등록)", S))
    story.append(Spacer(1, 5*mm))

    # 8. 행동특성 및 종합의견
    story.append(_section_header("8. 행동특성 및 종합의견", S))
    behavior_records = sorted(
        record_groups.get("behavior", []),
        key=lambda x: (x.year, x.semester),
    )
    if behavior_records:
        for r in behavior_records:
            story.append(Paragraph(
                f"<font color='#666666'>[{r.year}년 {r.semester}학기]</font> {r.content}",
                S["body"]))
    else:
        story.append(_empty_note("기록 없음", S))

    # 푸터 경고
    story.append(Spacer(1, 10*mm))
    story.append(Paragraph(
        f"※ 본 문서는 {school_name}에서 자동 생성된 보조자료이며, NEIS 공식 학교생활기록부와 다를 수 있습니다.",
        S["footer"],
    ))
    story.append(Paragraph(
        f"※ 출력 시점의 데이터를 기준으로 하며, 이후 변경된 사항은 반영되지 않습니다.",
        S["footer"],
    ))

    doc.build(story)
    return buffer.getvalue()
