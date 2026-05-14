# SQLite → PostgreSQL 전환 (1300명 규모용)

학교 1300명 운영을 위한 DB 전환 가이드. 본인 노트북 또는 학교 노트북에서 동일.

---

## 한 줄 요약

> WSL Ubuntu에서 PostgreSQL 설치 → DB/user 생성 → SQLite 데이터 PostgreSQL로 이전 → `.env` 변경 → backend 재시작.
> 두 자동화 스크립트로 약 10분 안에 끝남.

---

## Step 1. PostgreSQL 설치 + DB/user 생성 (1회만)

```bash
cd /home/sinbc/general_school
chmod +x scripts/setup_postgres.sh
./scripts/setup_postgres.sh
```

`sudo` 비밀번호 한 번 입력. 스크립트가 자동으로:
- `apt install postgresql`
- 서비스 시작 (`sudo service postgresql start`)
- DB `general_school`, user `app` 생성, 비밀번호 랜덤 hex 16
- 연결 테스트 (`SELECT 'OK'`)

마지막에 출력되는 한 줄을 **복사해두세요**:
```
DATABASE_URL=postgresql+asyncpg://app:xxxxx@localhost:5432/general_school
```

---

## Step 2. .env + start-backend.bat 변경

`.env` 파일 열어서:
```ini
# 이전
# DATABASE_URL=sqlite+aiosqlite:///general_school.db
# 이후
DATABASE_URL=postgresql+asyncpg://app:xxxxx@localhost:5432/general_school
```

`start-backend.bat`도 동일하게 (`DATABASE_URL='postgresql+asyncpg://...'` 으로 교체).

---

## Step 3. 기존 SQLite 데이터 이전

backend가 떠 있으면 먼저 종료. WSL 안에서:

```bash
cd /home/sinbc/general_school/backend
source venv/bin/activate
python -m scripts.migrate_sqlite_to_postgres
```

`yes` 입력 후 자동 진행:
1. PostgreSQL에 빈 테이블 스키마 생성 (`create_all`)
2. SQLite 모든 테이블 행 → PostgreSQL insert (외래키 순서)
3. PostgreSQL sequence(autoincrement) 재설정

---

## Step 4. backend 재시작 + 검증

```bash
start-backend.bat
```
검은 창에 `Application startup complete.` 떠야 함. 에러 나면 메시지 확인.

브라우저에서:
- 로그인 (1 / 11111111)
- 학생 목록 확인
- 한 학생 클릭 → PDF 생기부 다운로드 시도
- 공지사항 → 글 한 줄 작성 후 새로고침

---

## PostgreSQL이 SQLite와 다른 점 (운영 시 알아둘 것)

| 항목 | SQLite | PostgreSQL |
|---|---|---|
| DB 위치 | `backend/general_school.db` 파일 1개 | 별도 데이터 디렉터리(`/var/lib/postgresql/...`) |
| 백업 | 파일 복사 | `pg_dump general_school > backup.sql` |
| 복원 | 파일 교체 | `psql general_school < backup.sql` |
| 서버 실행 | 서버 없음 (Python 프로세스가 직접 읽음) | postgres 데몬 항상 실행 필요 |
| WSL 시작 시 | 자동 (파일이라) | `sudo service postgresql start` 필요 |

**Tip — WSL 부팅 시 PostgreSQL 자동 시작**:
```bash
# ~/.bashrc 끝에 추가
sudo service postgresql start 2>/dev/null
```
(sudo NOPASSWD 설정 필요. 또는 학교 노트북은 systemd로 항상 실행)

---

## 백업 자동화 (운영용)

학교 노트북에서 매일 새벽 백업 cron:

```bash
# /etc/cron.d/general_school_backup
0 3 * * * postgres pg_dump general_school > /backup/$(date +\%Y\%m\%d).sql
```

또는 시스템 내부 `/system/backup` 페이지로 ZIP 받아서 외장 SSD.

---

## 학교 노트북 실제 작업 순서 (방문 당일)

1. WSL Ubuntu 설치
2. `git clone git@github.com:sinbc2003/general_school.git`
3. 본 문서 Step 1~4 따라가기
4. 초기 데이터 시드 (NEIS export → CSV import)
5. backend/frontend 자동 시작 설정 (Windows 작업 스케줄러 또는 NSSM)

---

## 트러블슈팅

**"sudo: a password is required"**
→ 정상. 비밀번호 입력하면 됩니다. WSL 초기 설정 시 입력한 비밀번호.

**"could not connect to server: Connection refused"**
→ `sudo service postgresql start` 한 번 실행.

**"FATAL: password authentication failed for user app"**
→ `.env`의 비밀번호와 `setup_postgres.sh` 출력 비밀번호가 다름. 재확인.

**마이그레이션 중 일부 테이블 스킵**
→ legacy 컬럼이나 외래키 충돌. 스킵된 테이블 이름 확인 후 수동 처리 또는 무시 (예: legacy 백업 데이터).

**1300명 시드 데이터 어떻게 넣지?**
→ NEIS에서 학생 명단 Excel export → `/users` 페이지의 일괄 import 기능 (또는 `/system/enrollments`의 CSV import) 활용.
