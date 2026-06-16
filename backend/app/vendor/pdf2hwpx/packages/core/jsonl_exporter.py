#!/usr/bin/env python3
"""
MMD → JSONL 전처리기

문제-답-해설 매칭 + 이미지 로컬 저장.

출력 JSONL 형식:
{"number": 1, "question": "...", "answer": "3", "solution": "...", "source": "파일명"}

이미지는 output_dir/images/ 에 저장, MMD 내 URL을 상대경로로 치환.
"""

import os
import re
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# 문항번호 패턴
_Q_RE = re.compile(r'^\*{0,2}(\d{1,2})\.\*{0,2}\s*(?=\S)')
# 해설/정답 영역 시작 패턴
_SOL_HEADING_RE = re.compile(r'^#{1,3}\s*(해설|정답|풀이|답안|정답과\s*해설|해설과\s*정답)')
# 정답 추출 (① ~ ⑤, 숫자, 분수 등)
_ANSWER_RE = re.compile(r'(?:정답|답)\s*[:：]?\s*([①②③④⑤⑥⑦⑧⑨⑩\d\-/,\s]+?)(?:\s*$|\s+[^\d])', re.MULTILINE)
# 배점 추출: [3점], [4점], [ 3 점 ] 등
_SCORE_RE = re.compile(r'\[\s*(\d)\s*점\s*\]')
# Mathpix 이미지 URL
_IMG_URL_RE = re.compile(r'!\[([^\]]*)\]\((https://cdn\.mathpix\.com/[^)]+)\)')


def mmd_to_jsonl(
    mmd: str,
    output_dir: str,
    source: str = "",
    download_images: bool = True,
) -> tuple[str, list[str]]:
    """MMD 텍스트 → JSONL 파일 생성.

    Args:
        mmd: Mathpix Markdown 텍스트
        output_dir: 출력 디렉토리 (JSONL + images/)
        source: 원본 파일명
        download_images: True면 이미지 다운로드, False면 URL 유지

    Returns:
        (JSONL 파일 경로, warnings 리스트)
    """
    warnings: list[str] = []
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    img_dir = out_path / "images"

    # 1. 문제/해설 영역 분리
    questions, solutions = _split_questions_and_solutions(mmd)

    # 2. 이미지 다운로드 + URL→상대경로 치환
    img_counter = [0]
    if download_images:
        img_dir.mkdir(exist_ok=True)

    def _replace_img(text: str) -> str:
        def _repl(m):
            alt, url = m.group(1), m.group(2)
            if not download_images:
                return m.group(0)
            img_counter[0] += 1
            ext = "jpg"
            if "png" in url.lower():
                ext = "png"
            fname = f"img_{img_counter[0]:04d}.{ext}"
            local_path = img_dir / fname
            try:
                _download_file(url, str(local_path))
            except Exception as e:
                logger.warning(f"이미지 다운로드 실패: {url} — {e}")
                return m.group(0)  # 실패 시 원본 URL 유지
            return f"![{alt}](images/{fname})"
        return _IMG_URL_RE.sub(_repl, text)

    # 3. 번호 불일치 감지
    q_only = set(questions.keys()) - set(solutions.keys())
    s_only = set(solutions.keys()) - set(questions.keys())
    if q_only:
        warnings.append(f"해설 누락: {', '.join(str(n) for n in sorted(q_only))}번")
    if s_only:
        warnings.append(f"문제 누락 (해설만 존재): {', '.join(str(n) for n in sorted(s_only))}번")

    no_answer = []

    # 4. 매칭 + JSONL 생성
    records = []
    for q_num, q_text in sorted(questions.items()):
        sol_text = solutions.get(q_num, "")

        # 배점 추출
        score = 0
        score_match = _SCORE_RE.search(q_text)
        if score_match:
            score = int(score_match.group(1))

        # 정답 추출
        answer = ""
        ans_match = _ANSWER_RE.search(sol_text)
        if ans_match:
            answer = ans_match.group(1)
        if not answer:
            first_line = sol_text.split("\n")[0] if sol_text else ""
            ans_match2 = _ANSWER_RE.search(first_line)
            if ans_match2:
                answer = ans_match2.group(1)

        # 이미지 처리
        q_processed = _replace_img(q_text.strip())
        s_processed = _replace_img(sol_text.strip())

        if not answer.strip() and sol_text:
            no_answer.append(q_num)

        records.append({
            "number": q_num,
            "score": score,
            "question": q_processed,
            "answer": answer.strip(),
            "solution": s_processed,
            "source": source,
        })

    if no_answer:
        warnings.append(f"정답 미추출: {', '.join(str(n) for n in no_answer)}번")

    # JSONL 쓰기
    jsonl_name = re.sub(r'\.[^.]+$', '', source or "output") + ".jsonl"
    jsonl_path = out_path / jsonl_name
    with open(jsonl_path, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    logger.info(f"JSONL 생성: {len(records)}문항, 이미지 {img_counter[0]}개, 경고 {len(warnings)}건 → {jsonl_path}")
    return str(jsonl_path), warnings


def _split_questions_and_solutions(mmd: str) -> tuple[dict[int, str], dict[int, str]]:
    """MMD를 문제 영역과 해설 영역으로 분리, 각각 번호별 dict 반환."""
    lines = mmd.split("\n")

    # 해설 영역 시작 인덱스 찾기
    sol_start = -1
    for i, line in enumerate(lines):
        if _SOL_HEADING_RE.match(line.strip()):
            sol_start = i
            break

    if sol_start < 0:
        # 해설 영역이 없으면 전체를 문제로
        q_lines = lines
        s_lines = []
    else:
        q_lines = lines[:sol_start]
        s_lines = lines[sol_start:]

    questions = _extract_numbered_blocks("\n".join(q_lines))
    solutions = _extract_numbered_blocks("\n".join(s_lines))

    return questions, solutions


def _extract_numbered_blocks(text: str) -> dict[int, str]:
    """텍스트에서 번호별 블록 추출. {1: "1. 문제내용...", 2: "2. ..."}"""
    blocks: dict[int, str] = {}
    current_num = -1
    current_lines: list[str] = []

    for line in text.split("\n"):
        m = _Q_RE.match(line.strip())
        if m:
            # 이전 블록 저장
            if current_num > 0 and current_lines:
                blocks[current_num] = "\n".join(current_lines).strip()
            current_num = int(m.group(1))
            current_lines = [line]
        else:
            if current_num > 0:
                current_lines.append(line)

    # 마지막 블록
    if current_num > 0 and current_lines:
        blocks[current_num] = "\n".join(current_lines).strip()

    return blocks


def _download_file(url: str, path: str):
    """URL → 파일 다운로드"""
    import urllib.request
    urllib.request.urlretrieve(url, path)
