"use client";

import { Construction } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export function PlaceholderPage({
  title,
  description,
  icon: Icon = Construction,
}: PlaceholderPageProps) {
  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">{title}</h1>
      <div className="bg-bg-primary rounded-lg border border-border-default p-8 flex flex-col items-center justify-center min-h-[300px]">
        <Icon size={48} className="text-text-tertiary mb-4" />
        <p className="text-body text-text-secondary text-center">
          {description || "Phase 2/3에서 기존 플랫폼의 기능을 이관할 예정입니다."}
        </p>
        <p className="text-caption text-text-tertiary mt-2">
          관리자가 권한을 부여한 사용자만 이 메뉴를 볼 수 있습니다.
        </p>
      </div>
    </div>
  );
}
