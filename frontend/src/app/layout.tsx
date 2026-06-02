import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import { MenuProvider } from "@/lib/menu-context";
import { BrandingProvider } from "@/lib/branding-context";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

// SSR(서버)에서 백엔드 호출용 — 공개 URL(NEXT_PUBLIC_API_URL)은 SSR이 자기 자신을 터널로
// 되부르는 꼴이라 실패/지연 → 기본값 fallback 되던 문제가 있었다. 서버-내부 주소를 사용한다.
// 같은 호스트면 127.0.0.1:8002, 프론트/백엔드 분리 배포 시 INTERNAL_API_URL 지정.
const BACKEND_URL = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:8002";

/**
 * 백엔드에서 브랜딩 설정(탭 제목 / 파비콘 URL)을 가져와 동적 metadata 생성.
 * 최고관리자가 /system/settings의 "사이트 브랜딩" 섹션에서 변경 가능.
 * 백엔드 미응답 시 기본값 fallback.
 */
export async function generateMetadata(): Promise<Metadata> {
  let title = "학교 통합 플랫폼";
  let faviconUrl: string | undefined;
  try {
    const res = await fetch(`${BACKEND_URL}/api/system/branding`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data.title) title = data.title;
      // favicon_url은 "/api/system/branding/favicon?v=..." 상대경로 — 브라우저가 현재 origin
      // 기준으로 로드(nginx가 /api를 백엔드로 프록시). SSR fetch용 내부주소(BACKEND_URL)를
      // 붙이면 브라우저가 못 읽으므로 상대경로 그대로 사용.
      if (data.favicon_url) faviconUrl = data.favicon_url;
    }
  } catch {}

  return {
    title,
    description: "교사-학생 통합 학교 관리 플랫폼",
    icons: faviconUrl ? { icon: faviconUrl } : undefined,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>
          <MenuProvider>
            <ToastProvider>
              <BrandingProvider>{children}</BrandingProvider>
            </ToastProvider>
          </MenuProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
