# HWP/HWPX 통합 — 작업 기록

> 작업일: 2026-05-21
> 커밋: [`0cdfed2`](https://github.com/sinbc2003/general_school/commit/0cdfed2), [`2e14d60`](https://github.com/sinbc2003/general_school/commit/2e14d60)
> 라이브러리: `@rhwp/editor` v0.7.12 (MIT, by Edward Kim)

## 결론 한 줄

**단독 편집 + 저장 작동. 실시간 동시편집은 rhwp v1 한계로 불가 (LWW만 가능).**

---

## 무엇을 만들었나

### Backend (`backend/app/modules/classroom_hwps/`)

| 항목 | 내용 |
|---|---|
| 모델 | `ClassroomHwp`, `HwpMember` ([backend/app/models/classroom_hwp.py](../backend/app/models/classroom_hwp.py)) |
| Alembic | [`05a8708cef8d_add_classroom_hwps.py`](../backend/alembic/versions/05a8708cef8d_add_classroom_hwps.py) |
| 권한 | `classroom.hwp.create/view/edit/share` 4종 (학생 default 포함) |
| 업로드 정책 | `POLICY_HWP` (.hwp/.hwpx, 30MB) — `app/core/upload.py` |
| Storage 가드 | `_guard_hwps` (files/router.py `_GUARDS` 등록) |
| Drive 통합 | `ITEM_TYPES["hwps"]` — 휴지통·복구·영구삭제 자동 적용 |

**Endpoints** (prefix `/api/classroom/hwps`):

- `POST ""` — 빈 메타 생성
- `GET ""` — 본인 접근 가능한 목록 (`?course_id=`, `?mine=true`)
- `GET "/{hid}"` — 메타 + 권한
- `PUT "/{hid}"` — title / access_mode / is_archived
- `DELETE "/{hid}"` — soft delete (휴지통, 30일 후 자동 영구삭제)
- `PUT "/{hid}/file"` — 파일 본체 업로드 (multipart, validate_upload)
- `GET/POST/DELETE "/{hid}/members"` — 권한 멤버 CRUD

### Frontend

| 파일 | 역할 |
|---|---|
| [`components/hwp/HwpEditor.tsx`](../frontend/src/components/hwp/HwpEditor.tsx) | `@rhwp/editor` iframe 임베드, 단계별 로딩 UI |
| [`app/(admin)/hwps/[hid]/page.tsx`](../frontend/src/app/(admin)/hwps/[hid]/page.tsx) | 교사용 단독 페이지 |
| [`app/(student)/s/hwps/[hid]/page.tsx`](../frontend/src/app/(student)/s/hwps/[hid]/page.tsx) | 학생용 단독 페이지 |
| [`app/embed/hwps/[hid]/page.tsx`](../frontend/src/app/embed/hwps/[hid]/page.tsx) | fullscreen embed |
| `ShareDocModal` | `entityType="hwp"` 지원 |
| `DrivePage` / `DriveContextMenu` | hwps 탭, '+ 신규', 우클릭, 이름바꾸기 |
| `DrivePicker` / `PostDetailView` / `AssignmentModal` | 클래스룸 첨부에서 한컴 문서 선택 가능 |

### 동작

1. `/drive` → "+ 신규" → "한컴 문서" → 빈 hwp 생성 + `/hwps/{id}` 이동
2. 우상단 "가져오기" — 내 PC의 .hwp/.hwpx 파일 로드
3. "저장" — `editor.exportHwpx()` → backend `PUT /file`
4. "다운로드" — `editor.exportHwpx()` → 브라우저 다운로드
5. 공유 모달 — Google Docs 식 멤버/access_mode (doc과 동일 UX)
6. 휴지통 → 복구/영구삭제 — 30일 후 cron이 자동 영구삭제 + quota 환원

### 검증
- pytest convention/security/backup **48/48 pass**
- TypeScript **0 error**
- backend boot **440 routes**

---

## 실시간 동시편집은 왜 불가능한가

> 결론: **rhwp v1의 postMessage API가 편집 이벤트를 안 노출.** 외부에서 변경 사항을 잡을 방법이 없음.

`@rhwp/editor`가 노출하는 메서드는 **6개만**:
- `loadFile(bytes, name)` — 전체 파일 로드
- `exportHwp()` / `exportHwpx()` — 전체 파일 export
- `pageCount()` — 페이지 수
- `getPageSvg(page)` — SVG 렌더
- `destroy()` — 정리

**편집 이벤트(insertText/cursorMove/selectionChange)가 안 나옴** → Yjs/CRDT가 "변경 단위 broadcast" 못함.

쉬운 우회 (LWW snapshot)는 위험:
- A 편집 → 5초마다 `exportHwpx` → 서버 → B의 rhwp에 `loadFile` 재호출
- **B가 편집 중이었으면 작업 통째로 날아감** + 커서 사라짐
- 5초 폴링 = 5초마다 다른 사람 작업 덮어쓰기 = 데이터 손실 disaster

### 진짜 동시편집을 만들려면

**rhwp 본체 fork 필요** (MIT, fork 가능). 실제 조사 결과:

| 작업 | 난이도 | 기간 |
|---|---|---|
| (a) rhwp-studio에 postMessage 이벤트 추가 (`InsertText` 등 ~30개 hwpctl 액션 노출) | 중 | 며칠 |
| (b) op-log 기반 LWW 대체 (마지막 사람만 잠금) | 중상 | 1~2주 |
| (c) **진짜 CRDT (Google Docs 식 char-level)** | **극상** | **3개월+** |

**(c) 극상 이유**:
- HWP 문서 모델은 **nested binary struct** (표·문단·문자shape 중첩). TipTap=텍스트 트리, fortune-sheet=2D grid 와 달리 **기존 Y.XmlFragment/Y.Array 라이브러리 매핑 불가**
- HWP 전용 CRDT를 새로 설계해야 함 (학술 논문 수준)
- Cursor/selection 동기화 별도 작업 (rhwp 내부 API 미노출)
- Undo stack과 CRDT 충돌 해결
- 한컴 본가도 char-level CRDT 안 함 (한컴오피스 협업 = 잠금 기반)
- MS Word도 char-level CRDT 안 함 (서버 OT)

### 우리가 안 한 이유
- 학교 1400명 한컴 동시편집 실제 수요 = 미검증 (대부분 단독 작성 + 제출)
- 협업이 진짜 필요한 워크플로우는 **TipTap 문서** 권장 (이미 production-grade)
- 3개월+ 투자 = ROI(투자 대비 가치) 안 나옴

---

## 추후 방향 (옵션)

| 옵션 | 작업 | 기간 |
|---|---|---|
| **A. 잠금 기반 협업** | 한 명만 편집, 다른 사람 viewer + presence 표시. ClassroomHwp에 `locked_by_id` + `lock_expires_at` 추가, 30분 무활동 자동 해제, transfer 버튼 | 1.5~2h |
| **B. presence만** | 누가 보고 있는지 + 마지막 저장자 + "최근 저장됨" 알림. 충돌 회피는 사용자 책임 | 40분 |
| **C. 업스트림 PR** | rhwp에 "postMessage bridge for hwpctl actions" PR 제안. v2.0 협업 로드맵 있어 환영받을 가능성 | 30분 |
| **D. 진짜 CRDT** | 6주~3개월. 학교 운영용으로 ROI 안 나옴 | 3개월+ |

### 권고
1. 단기: HWP는 **단독 편집 유지** + 협업 필요하면 TipTap 권장
2. 중기: 수요 검증 후 **A (잠금 기반)** 도입
3. 장기: rhwp v2.0 출시 대기 (협업 명시되어 있음, 일정 미정)

---

## 로딩 시간 안내 (사용자 FAQ)

"HWP 에디터 로딩이 5~15초 걸려요"

**정상**. `@rhwp/editor`는 iframe으로 외부 사이트(`https://edwardkim.github.io/rhwp/`)를 띄우고 WASM 초기화를 기다림. 학교 네트워크에서 github.io 차단 시 실패.

**8초+ 지속 시 자동으로 진단 배너** 표시 (외부 URL 차단 가능성 안내 + 재시도 버튼).

self-host 원하면 rhwp 본체 fork → `rhwp-studio` 디렉토리 빌드 → 우리 서버에 정적 배포 → `HwpEditor.tsx`의 `STUDIO_URL` 변경.

---

## 참고

- rhwp 본체: <https://github.com/edwardkim/rhwp> (MIT)
- 협업 로드맵: README의 "v2.0 실시간 협업 편집"
- 대안 (모두 dead-end): hwp.js (viewer only, 2020 unmaintained), openhwp (parser only), HOP (Electron app, not embeddable)
