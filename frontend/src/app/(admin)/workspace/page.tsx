import { redirect } from "next/navigation";

/**
 * "내 작업물" 페이지는 "내 드라이브"에 통합됨 — /drive로 영구 리다이렉트.
 * 외부 링크·북마크 호환성을 위해 페이지는 유지.
 */
export default function WorkspaceRedirect() {
  redirect("/drive");
}
