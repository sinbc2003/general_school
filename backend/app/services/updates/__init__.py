"""GitHub 자동 업데이트 서브패키지.

public API:
  apply_update(db, *, user_id, dry_run) — 메인 엔트리포인트
  get_progress(db) — 진행 중인 업데이트 상태
  get_last_result(db) — 마지막 실행 결과
  is_running() — lock 파일 존재 여부

내부 모듈 (직접 import 불필요):
  executor.py — 메인 흐름 (apply_update)
  steps.py — 9단계 실행 함수 (backup, git_pull, alembic, ...)
  rollback.py — _rollback (3단계 복원)
  lock.py — lock 파일 관리
  progress.py — SchoolConfig JSON read/write
  shell.py — asyncio subprocess 헬퍼
"""

from app.services.updates.executor import apply_update
from app.services.updates.lock import is_running
from app.services.updates.progress import get_last_result, get_progress


__all__ = ["apply_update", "is_running", "get_progress", "get_last_result"]
