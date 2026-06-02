"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api/client";

interface Branding {
  title: string;
  schoolName: string;
  faviconUrl: string | null;
}

const DEFAULTS: Branding = {
  title: "학교 통합 플랫폼",
  schoolName: "학교 플랫폼",
  faviconUrl: null,
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

const BrandingContext = createContext<Branding>(DEFAULTS);

/**
 * 사이트 브랜딩(탭 제목·학교명·파비콘)을 백엔드에서 읽어 적용.
 *
 * SSR generateMetadata는 빌드 시점/공개URL fetch 이슈로 기본값으로 굳을 수 있어,
 * 클라이언트에서 직접 /api/system/branding을 읽어 document.title·favicon을 매번 적용한다.
 * (최고관리자가 /system/settings에서 변경 → 새로고침 시 즉시 반영, 재빌드 불필요)
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULTS);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    api
      .get<{ title?: string; school_name?: string; favicon_url?: string | null }>(
        "/api/system/branding",
      )
      .then((d) => {
        if (!alive || !d) return;
        setBranding({
          title: d.title || DEFAULTS.title,
          schoolName: d.school_name || DEFAULTS.schoolName,
          faviconUrl: d.favicon_url || null,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 제목·파비콘 적용. pathname 변경(클라이언트 네비게이션) 시에도 재적용 —
  // Next가 라우트 전환 시 document.title을 레이아웃 기본값으로 되돌리는 것 방지.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (branding.title) document.title = branding.title;
    if (branding.faviconUrl) {
      const href = branding.faviconUrl.startsWith("http")
        ? branding.faviconUrl
        : `${API_URL}${branding.faviconUrl}`;
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = href;
    }
  }, [branding, pathname]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);
