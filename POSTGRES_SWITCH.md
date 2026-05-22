# SQLite → PostgreSQL 전환

> ⚠️ **이 문서는 deprecated.** 본 프로젝트는 2026-05-14부로 PostgreSQL이 dev/운영 표준입니다. SQLite는 더 이상 지원하지 않습니다.

새 설치 / 운영은 아래 문서를 참조하세요:

- **새 PC dev 환경 설치**: [SETUP.md](./SETUP.md) Section 3 (`./scripts/setup_postgres.sh`)
- **학교 방문 셋업**: [DEPLOY_TO_SCHOOL.md](./DEPLOY_TO_SCHOOL.md) Section 3 (`bash scripts/setup-production.sh` 한 줄로 자동)
- **운영 명령 reference**: [production/README.md](./production/README.md)

---

## SQLite 잔존 데이터 이전 (legacy)

기존 SQLite 운영 중인 dev 환경에서 PostgreSQL로 이전이 필요한 경우만:

```bash
cd /home/sinbc/general_school
./scripts/setup_postgres.sh    # PostgreSQL + DB·user 생성

# .env의 DATABASE_URL을 PostgreSQL로 변경
nano .env
# DATABASE_URL=postgresql+asyncpg://app:xxxxx@localhost:5432/general_school

# 데이터 이전 (backend 종료 후)
cd backend
source venv/bin/activate
python -m scripts.migrate_sqlite_to_postgres   # yes 입력 후 자동 진행
```

자동 진행 내용:
1. PostgreSQL에 빈 테이블 스키마 생성 (`create_all`)
2. SQLite 모든 테이블 행 → PostgreSQL insert (외래키 순서)
3. PostgreSQL sequence(autoincrement) 재설정

---

## 트러블슈팅

**"sudo: a password is required"**
→ 정상. WSL 초기 설정 시 입력한 비밀번호.

**"could not connect to server: Connection refused"**
→ `sudo service postgresql start`.

**"FATAL: password authentication failed for user app"**
→ `.env`의 비밀번호와 `setup_postgres.sh` 출력 비밀번호가 다름. 재확인.

**마이그레이션 중 일부 테이블 스킵**
→ legacy 컬럼이나 외래키 충돌. 스킵된 테이블 이름 확인 후 수동 처리 또는 무시.
