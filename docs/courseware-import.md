# 코스웨어 문제 일괄 import 가이드

강좌 페이지 → "문제" 탭 → "문제 세트 출제" → "JSONL 업로드" 탭에서 일괄 등록.

## 1. JSONL 단독 (이미지 없음)

`.jsonl` 또는 `.json` 파일 1개. 한 줄 = 한 문제.

```jsonl
{"type": "multiple_choice", "content": "1+1은?", "answer_data": {"grader_type": "choices", "correct": ["B"], "choices": ["A. 1", "B. 2", "C. 3"]}, "answer": "2", "difficulty": "easy", "subject": "수학"}
{"type": "numeric", "content": "원주율을 소수 둘째자리까지", "answer_data": {"grader_type": "numeric", "value": 3.14, "tolerance": 0.005}}
{"type": "short_answer", "content": "조선왕조 4대왕은?", "answer_data": {"grader_type": "exact", "correct": "세종", "trim": true}}
{"type": "essay", "content": "이차함수의 그래프 개형을 설명하시오.", "answer_data": {"grader_type": "essay", "rubric": "꼭짓점·축·대칭성 3개 언급 시 만점"}}
```

샘플: [courseware-sample.jsonl](courseware-sample.jsonl)

**제약**: 5MB / 최대 5000문제. 한 번에 더 많이 필요하면 여러 파일로 분할.

## 2. ZIP 패키지 (이미지 포함, 권장)

이미지가 포함된 문제는 ZIP 1개로 묶어 업로드. 백엔드가 이미지를 `storage/courseware/`에 저장하고 본문의 경로를 자동 치환.

```
math-chapter1.zip
 ├ problems.jsonl    # 한 줄 = 한 문제, content에 ![](images/X.png) 형식
 └ images/
    ├ fig1.png
    ├ fig2.jpg
    └ graph-3.webp
```

`problems.jsonl` 예시:

```jsonl
{"type": "multiple_choice", "content": "다음 그래프를 보고 답하시오.\n\n![이차함수 그래프](images/fig1.png)\n\n꼭짓점의 좌표는?", "answer_data": {"grader_type": "choices", "correct": ["A"], "choices": ["A. (1, -2)", "B. (-1, 2)", "C. (2, 1)"]}, "subject": "수학"}
{"type": "short_answer", "content": "다음 도형 ![삼각형](images/fig2.jpg) 의 넓이는?", "answer_data": {"grader_type": "numeric", "value": 24, "tolerance": 0.01}, "subject": "수학"}
```

**이미지 경로 규칙**:
- 마크다운 형식 `![대체텍스트](images/파일명.확장자)`
- `./images/foo.png`, `/images/foo.png` 도 인식
- 지원 확장자: `.png .jpg .jpeg .webp .gif .svg`

**제약**:
- ZIP 자체 50MB, 압축 해제 후 200MB 한도
- 이미지 최대 500장
- JSONL 안에 참조 없는 이미지는 저장 안 함 (불필요한 디스크 낭비 방지)
- JSONL에서 참조했는데 ZIP에 없는 이미지가 있으면 dry-run에서 알림 후 실행 거부

## 3. 검증 흐름 (권장)

업로드 모달에서 파일 선택 → **"검증 실행 (dry-run)"** 클릭. 실제 저장은 안 하고:
- JSONL 줄 수
- 유효 문제 개수
- 오류 (line별 메시지)
- 이미지 매칭 개수 (ZIP인 경우)

검증 통과 → "생성" 버튼으로 실 저장.

## 4. answer_data 형식 (grader_type별)

| type | grader_type | answer_data 필드 |
|---|---|---|
| `multiple_choice` | `choices` | `correct: ["A", "C"]`, `choices: ["A. ...", "B. ...", ...]` |
| `short_answer` | `exact` | `correct: "정답"`, `case_sensitive: false`, `trim: true` |
| `short_answer` | `regex` | `pattern: "^[0-9]+$"`, `case_sensitive: false` |
| `numeric` | `numeric` | `value: 3.14`, `tolerance: 0.005` |
| `essay` | `essay` | `rubric: "..."`  (자동채점 X, 교사 수동 채점) |
| (모두) | `manual` / `llm` | 자동채점 X — 교사 수동 채점 또는 LLM (Phase 2) |

## 5. 공통 필드

- `type` (필수): multiple_choice / short_answer / numeric / essay / code
- `content` (필수): 본문 (1~20000자, LaTeX `$...$` 가능)
- `answer_data` (필수): 위 표 참조
- `answer`: 정답 표시용 짧은 문자열 (UI 결과 표에 노출)
- `solution`: 해설 (마감 후 학생에게 공개 옵션)
- `difficulty`: easy / medium / hard / olympiad
- `subject`: 과목명 (free text)
- `tags`: list[str] (선택, 검색·필터용)

## 6. 이미지 보안

- 저장 경로: `storage/courseware/{nanoid16}.{ext}` (추측 어려움)
- 인증된 사용자만 접근 (`/api/files/storage/courseware/...`)
- 외부 익명 노출 X (favicon 등 `/storage/branding/` 외에는 전부 가드됨)
- ZIP `..` / 절대경로 / zip-bomb 모두 차단
