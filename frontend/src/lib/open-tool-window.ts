/**
 * 도구 "새 창" 열기 — 창 이름을 `gs-embed-*`로 부여.
 *
 * window.name은 그 창 안에서 어디로 이동해도 유지되므로, admin 레이아웃이
 * 이 prefix를 보고 사이드바를 통째로 숨긴다 (새창 = 해당 에듀테크처럼 꽉 찬 화면).
 * /embed/* 라우트(보드·화이트보드 등)는 레이아웃 자체가 없어 이름 없이도 풀스크린.
 */
export function openToolWindow(href: string) {
  // 매번 고유 이름 — 같은 이름 재사용 시 기존 창을 재활용해버리는 것 방지
  window.open(href, `gs-embed-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
}

/** 현재 창이 도구 새창(embedded)인지 — admin 레이아웃 사이드바 숨김 판단용 */
export function isToolWindow(): boolean {
  return typeof window !== "undefined" && window.name.startsWith("gs-embed");
}
