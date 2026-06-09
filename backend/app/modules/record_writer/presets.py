"""생기부 종류 프리셋 — 종류 선택 시 대상 범위(scope_type) + 기본 항목 자동 구성.

한국 학교 생활기록부의 주요 영역. 글자수(char_max)는 학교·연도마다 다르므로 표준값을
기본으로 두고 교사가 항목 설정에서 조정한다. source_config의 type만 제안하며, 구체적
과제·설문 연결(assignment_id/survey_id)은 교사가 항목 설정에서 지정한다.
"""

RECORD_PRESETS: dict[str, dict] = {
    "subject": {
        "scope_type": "course",
        "columns": [
            {
                "name": "교과 세부능력 및 특기사항",
                "char_max": 500,
                "kind": "normal",
                "source_config": {"type": "assignment"},
                "system_prompt": (
                    "이 교과 수업에서 관찰된 학생의 학습 태도·탐구 과정·성취·성장을 "
                    "교과 세부능력 및 특기사항 형식으로 작성하라. 수업 활동·과제·발표 등 "
                    "구체적 근거를 들고, 막연한 칭찬·과장은 피한다."
                ),
            }
        ],
    },
    "individual": {
        "scope_type": "course",
        "columns": [
            {
                "name": "개인별 세부능력 및 특기사항",
                "char_max": 500,
                "kind": "normal",
                "source_config": {"type": "artifact"},
                "system_prompt": (
                    "특정 교과에 국한되지 않는 학생의 자기주도적 탐구·독서·활동을 개인별 "
                    "세부능력 및 특기사항으로 작성하라. 구체적 활동과 그로 인한 성장에 초점."
                ),
            }
        ],
    },
    "club": {
        "scope_type": "club",
        "columns": [
            {
                "name": "동아리활동 특기사항",
                "char_max": 500,
                "kind": "normal",
                "source_config": {"type": "club"},
                "system_prompt": (
                    "동아리 활동에서 학생이 맡은 역할·참여·산출물·협업·성장을 동아리활동 "
                    "특기사항으로 작성하라. 활동의 구체적 내용과 학생의 기여를 중심으로."
                ),
            }
        ],
    },
    "autonomous": {
        "scope_type": "homeroom",
        "columns": [
            {
                "name": "자율활동 특기사항",
                "char_max": 500,
                "kind": "normal",
                "source_config": {"type": "artifact"},
                "system_prompt": (
                    "학급·학교 자율활동(학급회의·행사·캠페인 등)에서 학생의 자발성·리더십·"
                    "협력·기여를 자율활동 특기사항으로 작성하라."
                ),
            }
        ],
    },
    "career": {
        "scope_type": "homeroom",
        "columns": [
            {
                "name": "진로활동 특기사항",
                "char_max": 700,
                "kind": "normal",
                "source_config": {"type": "career"},
                "system_prompt": (
                    "학생의 진로 탐색 과정·진로 활동·자기이해·진로 계획의 구체화를 진로활동 "
                    "특기사항으로 작성하라. 학생의 진로 설계와 그 근거 활동을 중심으로."
                ),
            }
        ],
    },
    "behavior": {
        "scope_type": "homeroom",
        "columns": [
            {
                "name": "행동특성 및 종합의견",
                "char_max": 500,
                "kind": "summary",
                "source_config": None,
                "system_prompt": (
                    "한 학기/학년 동안 관찰된 학생의 인성·태도·대인관계·성장을 종합하여 "
                    "행동특성 및 종합의견을 작성하라. 추천서 성격으로 학생의 강점과 발전 "
                    "가능성이 드러나게, 사실에 기반하여."
                ),
            }
        ],
    },
}
