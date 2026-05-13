"use client";

import { useAuth } from "@/lib/auth-context";
import { useMenuSettings } from "@/lib/menu-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { studentMenu } from "@/config/student-menu";
import { iconMap } from "@/config/menu-categories";
import { FeedbackPanel } from "@/components/feedback-panel";
import { LogOut, Menu as MenuIcon, X, ChevronRight, MoreHorizontal, Eye, ArrowLeft } from "lucide-react";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout, hasPermission } = useAuth();
  const { categories, isHidden } = useMenuSettings();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 학생 본인 + 관리자(super_admin/designated_admin)는 학생 영역 접근 가능
  // 교사/직원은 admin 영역으로 리다이렉트
  const canViewStudentArea =
    user && (user.role === "student" || user.role === "super_admin" || user.role === "designated_admin");
  const isPreview = user && user.role !== "student";

  useEffect(() => {
    if (loading) return;
    if (user && !canViewStudentArea) {
      router.push("/dashboard");
    }
  }, [user, loading, canViewStudentArea, router]);

  // 경로 변경 시 드로어 닫기
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary">로딩 중...</div>
      </div>
    );
  }

  if (!canViewStudentArea) return null;

  const menuByKey = new Map(studentMenu.map((m) => [m.key, m]));

  const isItemVisible = (key: string) => {
    const item = menuByKey.get(key);
    if (!item) return false;
    if (isHidden(key)) return false;
    return hasPermission(item.permission);
  };

  // 바텀 탭: 주요 5개 (홈, 문제, 대회, 커뮤, 설정)
  const primaryKeys = ["dashboard", "problems", "contest", "community", "profile"];
  const bottomTabs = primaryKeys
    .map((k) => menuByKey.get(k))
    .filter((m): m is NonNullable<typeof m> => !!m && hasPermission(m.permission));

  // 카테고리별로 메뉴 렌더링
  const categorizedKeys = new Set(categories.student.flatMap((c) => c.items));
  const uncategorized = studentMenu.filter(
    (m) => !categorizedKeys.has(m.key) && isItemVisible(m.key)
  );

  return (
    <div className="min-h-screen bg-bg-secondary pb-16">
      {/* 관리자 미리보기 배너 */}
      {isPreview && (
        <div className="sticky top-0 z-30 bg-status-warning text-white px-4 py-1.5 flex items-center justify-between text-caption">
          <div className="flex items-center gap-2">
            <Eye size={14} />
            <span>관리자 미리보기 모드 — 학생 화면이 어떻게 보이는지 확인 중. 본인의 학생 데이터가 없으면 빈 화면이 표시됩니다.</span>
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded hover:bg-white/30"
          >
            <ArrowLeft size={12} /> 관리자 화면으로
          </button>
        </div>
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-20 bg-bg-primary border-b border-border-default px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-text-secondary hover:text-text-primary"
          >
            <MenuIcon size={20} />
          </button>
          <span className="font-semibold text-body text-text-primary">
            학교 플랫폼
            {isPreview && <span className="ml-2 text-caption text-text-tertiary">(학생 화면)</span>}
          </span>
        </div>
        <button onClick={logout} className="text-text-tertiary hover:text-status-error">
          <LogOut size={18} />
        </button>
      </header>

      {/* 사이드 드로어 */}
      {drawerOpen && (
        <>
          {/* 오버레이 */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* 드로어 패널 */}
          <aside className="fixed top-0 left-0 h-full w-72 bg-bg-primary z-50 shadow-lg flex flex-col animate-slide-in">
            {/* 드로어 헤더 */}
            <div className="flex items-center justify-between h-12 px-4 border-b border-border-default">
              <span className="font-semibold text-body text-text-primary">메뉴</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1 hover:bg-bg-secondary rounded"
              >
                <X size={18} />
              </button>
            </div>

            {/* 카테고리별 메뉴 */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-3">
              {categories.student.map((cat) => {
                const visibleItems = cat.items.filter(isItemVisible);
                if (visibleItems.length === 0) return null;

                const CatIcon = iconMap[cat.icon] || MoreHorizontal;

                return (
                  <div key={cat.id}>
                    <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                      <CatIcon size={13} />
                      <span>{cat.name}</span>
                    </div>
                    <div className="space-y-0.5 mt-0.5">
                      {visibleItems.map((key) => {
                        const item = menuByKey.get(key)!;
                        const Icon = item.icon;
                        const active = pathname?.startsWith(item.path);
                        const cls = `flex items-center gap-2 px-3 py-2 text-[13px] rounded transition-colors ${
                          active
                            ? "bg-accent-light text-accent font-medium"
                            : "text-text-secondary hover:bg-bg-secondary"
                        }`;
                        if (item.newTab) {
                          return (
                            <a key={item.key} href={item.path} target="_blank" rel="noopener noreferrer" className={cls}>
                              <Icon size={16} />
                              <span className="flex-1">{item.label}</span>
                            </a>
                          );
                        }
                        return (
                          <Link key={item.key} href={item.path} className={cls}>
                            <Icon size={16} />
                            <span className="flex-1">{item.label}</span>
                            {active && <ChevronRight size={14} className="text-accent" />}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* 미분류 */}
              {uncategorized.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                    기타
                  </div>
                  <div className="space-y-0.5 mt-0.5">
                    {uncategorized.map((item) => {
                      const Icon = item.icon;
                      const active = pathname?.startsWith(item.path);
                      const cls = `flex items-center gap-2 px-3 py-2 text-[13px] rounded transition-colors ${
                        active
                          ? "bg-accent-light text-accent font-medium"
                          : "text-text-secondary hover:bg-bg-secondary"
                      }`;
                      if (item.newTab) {
                        return (
                          <a key={item.key} href={item.path} target="_blank" rel="noopener noreferrer" className={cls}>
                            <Icon size={16} />
                            <span>{item.label}</span>
                          </a>
                        );
                      }
                      return (
                        <Link key={item.key} href={item.path} className={cls}>
                          <Icon size={16} />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </nav>

            {/* 유저 정보 */}
            <div className="border-t border-border-default p-4">
              <div className="text-body font-medium text-text-primary">{user.name}</div>
              <div className="text-caption text-text-tertiary">
                {user.grade}학년 {user.class_number}반
              </div>
            </div>
          </aside>
        </>
      )}

      {/* 메인 */}
      <main className="p-4 max-w-content mx-auto">{children}</main>

      <FeedbackPanel />

      {/* 바텀 탭 */}
      <nav className="fixed bottom-0 left-0 right-0 h-14 bg-bg-primary border-t border-border-default flex items-center justify-around z-20">
        {bottomTabs.map((item) => {
          const Icon = item.icon;
          const isActive = pathname?.startsWith(item.path);
          return (
            <Link
              key={item.key}
              href={item.path}
              className={`flex flex-col items-center gap-0.5 ${
                isActive ? "text-accent" : "text-text-tertiary"
              }`}
            >
              <Icon size={20} />
              <span className="text-[10px]">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
