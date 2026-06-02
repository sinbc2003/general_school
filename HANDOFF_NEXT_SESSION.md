# 다음 세션 인계 — general_school ("이어서" 작업)

> 사용자가 **"이어서"** 라고 하면 이 문서를 읽고 아래 **남은 작업**을 우선순위 순으로 진행한다.
> (작성: 2026-06-02 / 갱신: 2026-06-02 2차 세션 — B·C·D 전부 완료·B배포. 현재 **필수 남은 작업 없음**, §3 참조)

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

## 3. 남은 작업 (이어서) — ✅ B·C·D 모두 완료 (2026-06-02 2차 세션, B 배포됨)

직전 핸드오프의 B·C·D를 모두 구현하고 GitHub push + 수성고 B 배포(BUILD_OK·gs-frontend active)까지 완료. **남은 필수 작업 없음.**

### ✅ B. 학생 선택 모달 — 완료 (commit f9acb3b)
- 신규 `frontend/src/components/StudentPickerModal.tsx` (재사용 컴포넌트): 학년/반 필터 + 이름·아이디 검색 + "현재 목록 전체 선택" + 이미등록 학생 "등록됨" 비활성 + 학번 붙여넣기 보조입력(접힘).
- `GET /api/users/peers?role=student` 사용 — `user.manage.view` 권한 없는 교사도 본인 강좌에 학생 등록 가능(`/api/users`는 권한 필요해서 회피).
- 클래스룸 강좌상세 `(admin)/classroom/[cid]/page.tsx`의 학번입력 `BulkAddModal` 제거 → StudentPickerModal로 교체. 백엔드 무변경(`CourseStudentBulk`가 user_ids/student_numbers 둘 다 지원).

### ✅ C. 내 정보 드롭다운 연동 — 완료 (commit 3836962)
- `(admin)/me/setup/page.tsx`: 담임/부담임 = 학급 `<select>`, 수업학년/수업학급 = 체크박스(학급은 선택 학년에서만 활성), 담당과목 = 체크박스. 모두 `enrollment.semester.classes_per_grade`/`subjects` 기반.
- `auth/teacher-onboarding/page.tsx`와 동일 UX·데이터경로(`GET /api/timetable/my-enrollment`). 자유텍스트(쉼표구분) 입력 제거. 백엔드 무변경(`_semester_to_dict`가 구조 제공).

### ✅ D. 메뉴 순서 — 완료 (commit 8667b54)
- `frontend/src/config/menu-categories.ts` `defaultCategories.admin`: **알림(공지) → 대시보드 → 드라이브 → 업무(내정보·시간표) → 이하 동일.** 알림·대시보드를 단일항목 카테고리로 승격, `Bell` 아이콘 추가.
- ⚠️ **시드(기본값)만 변경** — DB에 `menu_categories` 오버라이드가 저장돼 있으면 미적용 → `/system/menu`에서 조정. **B는 현재 오버라이드 없음(null) → 즉시 반영 확인됨.**

### ✅ E. 연구 담당학생 선택 모달 — 완료 (commit 94c0d58)
- `StudentPickerModal`에 **single 모드** 추가(한 명 클릭 즉시 선택, `onPick(student)`로 전체 row 전달).
- `(admin)/me/setup` 4번 섹션 + `(admin)/system/research-supervisors` CreateSupervisionModal: 학번/이름 typeahead → **명단 단일선택 모달**로 교체. 직접입력 제거.

### ✅ F. 초기 비밀번호 = 전화번호(숫자만) — 완료 (commit 4bec709)
- `_helpers.phone_to_initial_password()`: 전화번호에서 비숫자 제거 → 초기 비번.
- `create_user`: 비번 우선순위 = **명시비번(임시) → 전화번호숫자 → DEFAULT_USER_PASSWORD(폴백)**. 교사·학생 공통, `must_change_password=True` 유지.
- 마법사 `Step4Teachers`/`Step5Students`: '임시 비번' 칸 추가 — 연락처 없을 때 입력. password는 임시비번만 전송(없으면 백엔드가 phone derive). 연락처·임시 둘 다 없으면 공통기본비번 경고.
- 검증: 헬퍼 단위테스트 + 해시 라운드트립(연락처로 만든 비번 로그인) B에서 통과. CSV import(`user_csv_io`)는 phone 컬럼 없음 → 그대로(명시 password 칸 사용).

### ✅ G. 비밀번호 초기화 = 전화번호 우선 — 완료 (commit 0ea97bb)
- `sessions.py reset_password`: **전화번호(숫자만) 있으면 그것으로, 없으면 관리자 지정 비번(body.password)**으로 초기화. 둘 다 없으면 400. `must_change_password=True`. 응답 `{password, source}`(기존 공통 default_password 노출 대체).
- `/users` 초기화 버튼: 전화번호 있으면 확인→폰번호, 없으면 `prompt`로 임시비번 입력. `UserItem`에 phone 추가.
- 검증: 3경우(phone/manual/400) B에서 통과. reset 경로의 DEFAULT_USER_PASSWORD 의존 제거.

### ✅ H. CSV 일괄등록도 연락처 기반 초기비번 — 완료 (commit 6fb2ff5)
- `user_csv_io.py`: CSV/xlsx 템플릿에 **'연락처' 컬럼** 추가(비밀번호 다음). 한글 별칭 매핑.
- 초기비번 = 명시비번 → 연락처(숫자만) → DEFAULT. `phone`을 User에 저장. 마법사 '엑셀 일괄 등록' + CSV 업로드 모두 적용.
- 검증 B 통과(연락처→비번, 명시 우선, 무폰→DEFAULT). **→ 등록(마법사 줄입력·CSV)·초기화 전부 "연락처 우선" 일관 완성.**
- **개선 (commit ceafa70)**: CSV/xlsx 템플릿에서 **'비밀번호' 컬럼 폐지**(연락처가 곧 초기비번), 연락처 예시 '-' 없이(`01012345678`). 마법사 Step4/5 **per-row 임시비번 제거 → 상단 '일괄 임시 비번' 한 칸**(핸드폰 없는 사람 전원에 적용). 연락처 placeholder '-' 없이. import은 password 컬럼 있으면 호환 사용.

### ✅ I. 개설과목 마법사 등록 + me/setup 학급/학년 학생기반 — 완료 (commit 02b5e0d)
- **마법사 Step3Semesters**: '개설 과목' 등록 UI 추가 → 현재 학기 `subjects`를 `PUT /api/timetable/semesters/{id}/structure`로 저장. me/setup 담당과목 드롭다운의 표준 소스. 자유입력 X, 추가/수정·시스템→학기관리에서도 가능.
- **me/setup**: 담임/수업 학급 = **등록 학생 명단(학년+반)에서 도출**(+classes_per_grade 합집합), 수업 학년 = 학생 학년. 담당과목 = `semester.subjects`. → 마법사가 classes_per_grade를 안 채우던 문제 해결.
- **배경**: 마법사 Step1은 grade_count만, classes_per_grade·subjects는 마법사 미수집(확인: B에서 None). 그래서 학급=학생도출, 과목=마법사등록으로 전환.
- **✅ 교사 템플릿 담당과목 드롭다운 — 완료 (commit c791be1)**: 교사 CSV/xlsx 템플릿에 '담당과목' 컬럼+xlsx 드롭다운(현재학기 개설과목). CSV import가 **모든 임포트 사용자에 현재학기 enrollment 자동생성**(기존엔 미생성=명단누락 버그였음)하고, 교사는 `teaching_subjects` 저장. 미등록 과목은 행 오류로 거부(자유입력 차단). B 검증 통과(수학→OK+enrollment, 체육→거부).

### 참고 (비필수)
- **me/setup 드롭다운**은 학교 구조(`classes_per_grade`/`subjects`) 설정이 선행돼야 항목이 보임(미설정 시 "관리자에게 요청" 안내) — teacher-onboarding과 동일.
- **research-supervisors의 교사(담당교사) 선택**은 여전히 typeahead(`/api/users?role=teacher,staff`) — 교사 수가 적어 유지. 필요 시 동일 패턴으로 picker화 가능.
- ⚠️ **B는 factory_reset됨**(2026-06-02): users 0, 학생/학교구조 없음 → StudentPicker/me/setup 화면 기능검증은 데이터 시드 후 가능. 첫 `/auth/register` = super_admin.

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
