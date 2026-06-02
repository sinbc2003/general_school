# 다음 세션 인계 — general_school ("이어서" 작업)

> 사용자가 **"이어서"** 라고 하면 이 문서를 읽고 아래 **남은 작업**을 우선순위 순으로 진행한다.
> (작성: 2026-06-02 세션 종료 시점)

---

## 1. 환경 / 작업 방법

- **코드**: WSL `/home/sinbc/general_school` = GitHub `sinbc2003/general_school` (39모듈 운영코드)
  - ⚠️ OneDrive의 `teacher_student/general_school`는 **구버전 사본**. 작업은 반드시 WSL repo에서.
  - 파일 편집은 `\\wsl.localhost\Ubuntu\home\sinbc\general_school\...` 경로로 Read/Edit/Write.
- **운영 서버 B**: `ssh susung@100.92.66.61` (Tailscale 고정 IP) — Ubuntu, `~/general_school`
- **배포 흐름**:
  1. WSL에서 수정 → `git add/commit/push origin main` (커밋 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)
  2. B 배포 (PowerShell에서 ssh):
     - `cd ~/general_school && git pull --ff-only`
     - **backend 변경**: `sudo systemctl restart gs-backend`
     - **frontend 변경**: `cd frontend && npm run build && cp -r .next/static .next/standalone/.next/ && cd .. && sudo systemctl restart gs-frontend` (빌드 1~3분)
  3. ⚠️ **PowerShell ssh는 따옴표/`|`를 깨먹음** → base64 래핑 필수:
     ```powershell
     $s = @'
     <bash script>
     '@
     $b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))
     ssh -o BatchMode=yes susung@100.92.66.61 "echo $b | base64 -d | bash"
     ```
  4. push 거부(non-fast-forward) 시: `git pull --rebase origin main && git push`
- **문법검증**: backend는 `wsl ... python3 -m py_compile <file>`; frontend는 B 빌드에서 검증.
- **B 동작검증**: `cd backend && ./venv/bin/python3 <<'PY' ... await db.rollback() ... PY` (테스트 데이터 rollback).
- **현재 B 상태**: 초기화됨(users 0, 첫 회원가입=super_admin), `ENV=production`, **SMTP 미설정**(2FA 코드는 `journalctl -u gs-backend`에 찍힘). 가입 막히면 로그에서 코드 확인.
- **전체 초기화**(테스트 후): `factory_reset` — `cd backend && ./venv/bin/python3 -c "import asyncio, app.main; from app.core.database import async_session_factory; from app.services.backup import factory_reset; asyncio.run((lambda: ...)())"` 또는 UI `/system/backup` Danger Zone.

---

## 2. 이번 세션 완료 (전부 B+GitHub 배포됨)

- **enrollment 연동 (클래스룸-학생 매칭 근본수정)** — `create_user`가 현재학기 `SemesterEnrollment` 자동생성 + `POST /api/timetable/enrollments/_set-homeroom` 신규 구현(Step6 담임매핑). 검증: 학급강좌에 학생 매칭 OK.
- **학기 carry-over** — `SemesterFormModal` 신규생성 시 직전학기 자동선택 (`copy_enrollments` 기본 ON).
- **버그픽스** — multi-role 필터(`role=teacher,staff` split→`in_`), 전화번호 표준화(`_format_phone`), 교사 xlsx 템플릿+부서 드롭다운, Danger Zone 전체초기화, gs-status 깜빡임 제거, 발신자 표시이름(`from_name`), 사용자등록 템플릿 xlsx 일관화.

---

## 3. 남은 작업 (이어서 — 우선순위 순)

### ⭐ B. 학생 선택 모달 (수강생/연구담당 등록 UX)
- **문제**: 클래스룸 수강생 추가가 **학번 직접입력**(불편·오타). 연구담당 학생 등록도 직접입력.
- **목표**: 등록된 **전교생 목록에서 모달로 선택**. 학년/학급별 필터 + 학년·학급 **전체선택 한 번에**.
- **관련 코드**:
  - 수강생 추가 API: `backend/app/modules/classroom/router.py` — `POST /courses/{cid}/students` (572), `POST /courses/{cid}/students/bulk` (620, 학번 기반)
  - 전교생 조회: `GET /api/users?role=student` (응답 `{items,total}`, multi-role split 수정됨) / 또는 `GET /api/users/peers` (`search_peers`, UserPicker 패턴)
  - frontend: 학번입력 모달(사진의 "학생 일괄 등록") 찾아 → **전교생 선택 모달**로 교체. 재사용 `StudentPickerModal` 컴포넌트 신규 권장.
  - 연구담당: `past_research` / research supervision 모듈의 학생 등록부.
- **원칙**: 모든 학생/교사 선택 = **직접입력 금지 → 등록 명단 기반 모달/드롭다운**.

### C. 드롭다운 연동 (내 정보 등록)
- **문제**: 내정보(수업/학급/과목/연구담당)가 직접입력 → 오타·비표준.
- **목표**: 마법사 등록 데이터 기반 **드롭다운** (학기 enrollment, 개설 과목).
- **관련 코드**:
  - 내정보: `/me/setup` 페이지 + `PUT /api/timetable/my-enrollment/onboarding`
  - 과목 소스: `Semester.subjects`(학기 구조) 또는 `Course`. 마법사 Step3Semesters(학기구조)·Step7Courses 확인.
  - 학급/학년: enrollment 기반.

### D. 메뉴 순서 (대시보드 위치) — 화면에서 가능
- **목표**: 대시보드를 "업무" 카테고리 밖, **"알림(공지)" 바로 아래** → 그 뒤 드라이브 순.
- **방법**: 메뉴는 DB 설정 (`frontend/src/lib/menu-context.tsx` + `/system/menu` 관리화면에 `moveItem`/`moveCategory` 있음). **사용자가 화면에서 직접 조정 가능 → 코드 0**. 기본값 바꾸려면 menu seed 확인.

---

## 4. 핵심 데이터 흐름 (반드시 이해)

```
User(계정)  ──자동──▶  SemesterEnrollment(학기 명단, 모든 기능의 기반)
                              │
        ┌─────────────────────┼──────────────────────┐
   homeroom_class          (시간표)              teaching_subjects
   (담임 학급)                                    (담당 과목)
        │
   course_seed.seed_class_homeroom:
     학급강좌 owner = enrollment.homeroom_class(담임)
     학급강좌 학생 = User.grade/class_number 매칭
```
- **모든 학생/교사 기능은 enrollment 기반이어야** (직접입력 X, 명단 기반 선택 O).
- enrollment 운영 4종 완비: ①개별등록→자동명단(`create_user`) ②새학기→이전명단복사(`copy_enrollments`) ③진급(`promote-to`) ④개별수정(enrollment CRUD).
