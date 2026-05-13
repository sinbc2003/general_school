import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import { MenuProvider } from "@/lib/menu-context";
import "./globals.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

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
      if (data.favicon_url) faviconUrl = `${BACKEND_URL}${data.favicon_url}`;
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
          <MenuProvider>{children}</MenuProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
