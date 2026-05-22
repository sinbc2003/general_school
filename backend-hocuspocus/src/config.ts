/**
 * 환경변수 로드 + 기본값.
 *
 * 운영 시 .env 또는 systemd Environment= 로 주입.
 */

import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`[hocuspocus] env ${name} 가 설정되지 않았습니다`);
  }
  return v;
}

export const config = {
  // WebSocket 포트
  port: parseInt(process.env.PORT ?? "1234", 10),

  // 우리 FastAPI와 공유해야 하는 JWT 비밀.
  // backend의 settings.JWT_SECRET와 정확히 일치해야 함 (HS256).
  jwtSecret: required("JWT_SECRET", "change-this-in-production"),
  jwtAlgorithm: (process.env.JWT_ALGORITHM ?? "HS256") as "HS256" | "HS384" | "HS512",

  // FastAPI base URL — 권한 조회 + snapshot 저장/로드에 사용.
  fastapiUrl: process.env.FASTAPI_URL ?? "http://localhost:8002",

  // FastAPI snapshot POST 시 인증용 토큰. backend의 환경변수와 동일해야 함.
  internalToken: required("HOCUSPOCUS_INTERNAL_TOKEN", "dev-internal-token"),

  // snapshot debounce (ms). 너무 짧으면 DB IO 부하, 너무 길면 DB와 in-memory 차이 ↑.
  // 15초 — 서버 다운 시 최근 손실 1분 → 15초로 단축 (1500명 운영 대비).
  // 부하 우려: 15초마다 변경 중인 문서별 1회 POST. 1500 동접 × 20명/문서 = 75 문서.
  // 15초 디바운스 → 분당 ~300 POST → FastAPI worker 6개로 충분.
  snapshotDebounceMs: parseInt(process.env.SNAPSHOT_DEBOUNCE_MS ?? "15000", 10),

  // 운영 환경 표시 (로그/에러 처리 분기에 사용)
  env: process.env.ENV ?? "dev",
};
