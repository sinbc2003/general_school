"""과거 연구 보고서 파일명 파서 테스트."""

import pytest

from app.modules.past_research.parser import parse_filename


def test_parse_basic():
    r = parse_filename(
        "2024 2학년 1학기 과학과제연구 보고서(물리 분야)_다이오드의 특성 곡선과  실생활 응용에 관한 연구.pdf"
    )
    assert r is not None
    assert r["year"] == 2024
    assert r["grade"] == 2
    assert r["semester"] == 1
    assert r["report_type"] == "과학과제연구"
    assert r["fields"] == ["물리"]
    assert "다이오드" in r["title"]
    assert r["is_excellent"] is False


def test_parse_multi_field():
    r = parse_filename(
        "2026 3학년 1학기 심층연구활동 보고서(화학, 인공지능 분야)_두 약물 병용 복용 시 부작용 발생 가능성을 예측하는 인공지능 모델 개발에 관한 연구.pdf"
    )
    assert r is not None
    assert r["year"] == 2026
    assert r["grade"] == 3
    assert r["report_type"] == "심층연구활동"
    assert r["fields"] == ["화학", "인공지능"]


def test_parse_excellence_tag():
    r = parse_filename(
        "2024 2학년 1학기 과학과제연구 보고서(화학 분야)_탁구공 반발계수에 영향을 주는 요인에 관한 연구(우수).pdf"
    )
    assert r is not None
    assert r["is_excellent"] is True
    assert "탁구공" in r["title"]
    assert "(우수)" not in r["title"]


def test_parse_compound_field():
    r = parse_filename(
        "2024 2학년 1학기 과학과제연구 보고서(화학, 생명과학 분야)_수생식물을 이용한 폐의약품수 정화에 대한 탐구.pdf"
    )
    assert r is not None
    assert "화학" in r["fields"]
    assert "생명과학" in r["fields"]


def test_parse_with_path_prefix():
    r = parse_filename(
        "subdir/2024 2학년 1학기 과학과제연구 보고서(물리 분야)_제목.pdf"
    )
    assert r is not None
    assert r["year"] == 2024


def test_parse_invalid_returns_none():
    assert parse_filename("random_filename.pdf") is None
    assert parse_filename("") is None
    assert parse_filename("2024_test.pdf") is None
