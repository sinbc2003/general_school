/**
 * Hocuspocus(Yjs) WebSocket URL 결정 — 빌드타임 env 없이도 production에서 동작.
 *
 * 우선순위:
 * 1) NEXT_PUBLIC_HOCUSPOCUS_URL (빌드타임 인라인 — 명시 설정 시 그대로)
 * 2) next dev: ws://<현재호스트>:1234 — Hocuspocus 직결 (nginx 없음)
 * 3) production: ws(s)://<현재호스트>/yjs — nginx reverse proxy 경유
 *
 * production을 런타임 derivation으로 두는 이유: 학교 서버(B)는 망 이동으로
 * IP가 바뀌는데(gs-autoip), NEXT_PUBLIC_*은 빌드에 인라인되므로 IP를 박으면
 * 매번 재빌드가 필요해진다. 현재 접속 host 기준이면 재빌드 없이 항상 맞다.
 *
 * SSR 시점엔 window가 없어 dev 기본값을 반환하지만, 협업 에디터는 모두
 * client-only(dynamic/ssr:false 또는 effect 내 연결)라 실사용되지 않는다.
 */
export function getHocuspocusUrl(): string {
  const env = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  if (env) return env;
  if (typeof window === "undefined") return "ws://localhost:1234";
  const { protocol, hostname, host } = window.location;
  if (process.env.NODE_ENV === "development") {
    return `ws://${hostname}:1234`;
  }
  const wsProto = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${host}/yjs`;
}
