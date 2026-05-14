"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, LogOut, Menu, MoreHorizontal, CalendarRange } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { useMenuSettings } from "@/lib/menu-context";
import { useSidebar } from "@/lib/sidebar-context";
import { adminMenu, type MenuItem } from "@/config/admin-menu";
import { iconMap, type MenuCategory } from "@/config/menu-categories";

// 대메뉴(카테고리) 블록 — 항상 표시. 파스텔 블루 (펼치든 접든 동일).
const CATEGORY_BG_DEFAULT = "bg-blue-50";
// 카테고리 내부의 토글(자식 있는 메뉴) — 카테고리와 구분되는 작은 블록.
// 파스텔 앰버 (warm)로 시각적으로 다른 위계 표시.
const SUBMENU_BG_DEFAULT = "bg-amber-50/70";

interface CurrentSemester {
  id: number;
  year: number;
  semester: number;
  name: string;
  is_current: boolean;
}

export function AdminSidebar() {
  const { user, logout, hasPermission, isSuperAdmin } = useAuth();
  const { categories, isHidden } = useMenuSettings();
  const { collapsed, toggle: toggleCollapsed } = useSidebar();
  const pathname = usePathname();
  const [currentSem, setCurrentSem] = useState<CurrentSemester | null>(null);

  // 현재 학기 fetch (사용자 로그인 후 1회)
  useEffect(() => {
    if (!user) return;
    api
      .get<CurrentSemester | null>("/api/timetable/semesters/current")
      .then((d) => setCurrentSem(d))
      .catch(() => setCurrentSem(null));
  }, [user, pathname]);

  // 모든 admin 카테고리 default = 펼침. (admin) → (student) layout 전환으로
  // 사이드바가 재마운트되더라도 토글이 닫히지 않게 categories 기반으로 초기화.
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    () => new Set(categories.admin.map((c) => c.id))
  );
  const [openSubmenus, setOpenSubmenus] = useState<Set<string>>(new Set());

  // 사이드바 스크롤 위치 보존 — (admin) ↔ (student) layout 전환으로 nav가 재마운트돼도
  // 마지막 scrollTop을 sessionStorage에 저장 → 다음 마운트 시 복원.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const saved = sessionStorage.getItem("admin-sidebar-scroll");
    if (saved) {
      const top = parseInt(saved, 10);
      if (!Number.isNaN(top)) el.scrollTop = top;
    }
  }, []);
  const handleNavScroll = () => {
    if (navRef.current) {
      sessionStorage.setItem("admin-sidebar-scroll", String(navRef.current.scrollTop));
    }
  };

  const toggleCategory = (id: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSubmenu = (key: string) => {
    setOpenSubmenus((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // adminMenu를 key로 빠르게 조회
  const menuByKey = new Map(adminMenu.map((m) => [m.key, m]));

  const isVisible = (item: MenuItem): boolean => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    // role 기반 필터
    if (item.roles && item.roles.length > 0) {
      if (!user || !item.roles.includes(user.role)) return false;
    }
    if (item.excludeRoles && user && item.excludeRoles.includes(user.role)) return false;
    if (item.permission && !hasPermission(item.permission)) return false;
    if (isHidden(item.key)) return false;
    if (item.children) {
      return item.children.some((c) => isVisible(c));
    }
    return true;
  };

  const isActive = (path?: string) => path && pathname?.startsWith(path);

  // 카테고리에 표시할 수 있는 항목이 있는지 확인
  const categoryHasVisibleItems = (cat: MenuCategory): boolean => {
    return cat.items.some((key) => {
      const item = menuByKey.get(key);
      return item && isVisible(item);
    });
  };

  const renderMenuItem = (item: MenuItem, depth = 0) => {
    if (!isVisible(item)) return null;
    const Icon = item.icon;
    const indentPx = depth === 0 ? "pl-3" : depth === 1 ? "pl-8" : "pl-12";

    if (item.children) {
      // 'student-area'는 super_admin용 학생 화면 미리보기 — children path가 다른 메뉴와
      // 겹쳐서 자동 펼치면 사용자가 의도하지 않은 토글이 열림. 명시적 클릭으로만 펼침.
      const isPreviewMenu = item.key === "student-area";
      const parentActive = !isPreviewMenu && item.children.some((c) => c.path && isActive(c.path));
      // parentActive면 자동 펼침 유지 (자식 페이지로 이동해도 토글 닫히지 않게)
      const isOpen = openSubmenus.has(item.key) || parentActive;
      // 자식 있는 토글 — 카테고리와 구별되는 작은 색 블록 (앰버 톤).
      // collapsed 모드는 색 없이 아이콘만.
      const submenuBg = !collapsed ? SUBMENU_BG_DEFAULT : "";
      return (
        <div key={item.key}>
          <button
            onClick={() => toggleSubmenu(item.key)}
            className={`w-full flex items-center gap-2 ${indentPx} pr-2 py-2 text-[13.5px] rounded transition-colors ${submenuBg} ${
              parentActive
                ? "text-accent font-medium ring-1 ring-amber-200"
                : "text-text-primary hover:brightness-95"
            }`}
          >
            <Icon size={15} className="flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </>
            )}
          </button>
          {isOpen && !collapsed && (
            <div
              className={`space-y-0.5 mt-0.5 ml-3 pl-2 border-l-2 ${
                parentActive ? "border-amber-300" : "border-amber-100"
              }`}
            >
              {item.children.map((child) => renderMenuItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // depth=0: 일반 메뉴 (대), depth≥1: 서브메뉴 (약간 작고 옅음)
    const sizeCls = depth === 0 ? "text-[13.5px]" : "text-[12.5px]";
    const cls = `flex items-center gap-2 ${indentPx} pr-2 py-2 ${sizeCls} rounded transition-colors ${
      isActive(item.path)
        ? "bg-accent-light text-accent font-medium"
        : depth === 0
          ? "text-text-primary hover:bg-bg-secondary"
          : "text-text-secondary hover:bg-bg-secondary"
    }`;

    if (item.newTab) {
      return (
        <a
          key={item.key}
          href={item.path || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
        >
          <Icon size={depth === 0 ? 15 : 13} className="flex-shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </a>
      );
    }

    return (
      <Link key={item.key} href={item.path || "#"} className={cls}>
        <Icon size={depth === 0 ? 15 : 13} className="flex-shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  // 어떤 카테고리에도 속하지 않은 메뉴 항목 수집
  const categorizedKeys = new Set(categories.admin.flatMap((c) => c.items));
  const uncategorized = adminMenu.filter(
    (m) => !categorizedKeys.has(m.key) && isVisible(m)
  );

  const roleLabel: Record<string, string> = {
    super_admin: "최고관리자",
    designated_admin: "지정관리자",
    teacher: "교사",
    staff: "직원",
  };

  return (
    <aside
      className={`fixed top-0 left-0 h-full bg-bg-primary border-r border-border-default flex flex-col transition-all duration-200 z-30 ${
        collapsed ? "w-sidebar-collapsed" : "w-sidebar"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-header px-3 border-b border-border-default">
        {!collapsed && (
          <span className="font-semibold text-body text-text-primary truncate">
            학교 플랫폼
          </span>
        )}
        <button
          onClick={toggleCollapsed}
          className="p-1 hover:bg-bg-secondary rounded"
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          <Menu size={18} />
        </button>
      </div>

      {/* 현재 학기 표시 (admin sidebar 상단) */}
      {!collapsed && (
        <Link
          href={isSuperAdmin ? "/system/semesters" : "#"}
          className={`flex items-center gap-2 px-3 py-2 border-b border-border-default text-caption ${
            isSuperAdmin ? "hover:bg-bg-secondary cursor-pointer" : "cursor-default"
          }`}
          title={isSuperAdmin ? "학기 관리로 이동" : ""}
        >
          <CalendarRange size={14} className="text-accent flex-shrink-0" />
          {currentSem ? (
            <div className="flex-1 min-w-0">
              <div className="text-text-primary font-medium truncate">{currentSem.name}</div>
              <div className="text-text-tertiary text-[11px]">현재 학기</div>
            </div>
          ) : (
            <span className="text-text-tertiary">학기 미설정</span>
          )}
        </Link>
      )}
      {collapsed && currentSem && (
        <div className="flex justify-center py-2 border-b border-border-default" title={`현재 학기: ${currentSem.name}`}>
          <CalendarRange size={16} className="text-accent" />
        </div>
      )}

      {/* Menu — 카테고리별 그룹 */}
      <nav
        ref={navRef}
        onScroll={handleNavScroll}
        className="flex-1 overflow-y-auto p-2 space-y-2"
      >
        {categories.admin.map((cat) => {
          if (!categoryHasVisibleItems(cat)) return null;

          const CatIcon = iconMap[cat.icon] || MoreHorizontal;
          const isOpen = openCategories.has(cat.id);

          // 이 카테고리에 현재 페이지 메뉴가 속하는지 확인 (위치 강조).
          // 'student-area'(미리보기 토글)는 다른 메뉴와 path가 겹치므로 매칭에서 제외 —
          // 학생관리 카테고리 클릭 시 미리보기 카테고리까지 강조되는 혼선 방지.
          const isActiveCategory =
            !!pathname &&
            cat.items.some((key) => {
              if (key === "student-area") return false;
              const item = menuByKey.get(key);
              const matches = (mi: MenuItem): boolean => {
                if (mi.path && pathname.startsWith(mi.path)) return true;
                return !!mi.children?.some(matches);
              };
              return item ? matches(item) : false;
            });

          // 카테고리 헤더: 펼치든 접든 항상 블록 색 (파스텔 블루).
          // 활성 카테고리(현재 페이지 포함)는 강조 테두리 + accent 색.
          const headerCls = collapsed
            ? "text-text-secondary hover:text-text-primary"
            : isActiveCategory
            ? `${CATEGORY_BG_DEFAULT} text-accent border border-blue-200`
            : `${CATEGORY_BG_DEFAULT} text-text-primary hover:brightness-95`;

          return (
            <div key={cat.id}>
              {/* 카테고리 헤더 */}
              <button
                onClick={() => toggleCategory(cat.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[11.5px] font-bold uppercase tracking-wide transition-colors ${headerCls} ${!collapsed ? "rounded-md" : ""}`}
                title={collapsed ? cat.name : undefined}
              >
                {!collapsed && (
                  <>
                    <CatIcon size={13} className="flex-shrink-0" />
                    <span className="flex-1 text-left">{cat.name}</span>
                    {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </>
                )}
                {collapsed && <CatIcon size={16} className="mx-auto" />}
              </button>

              {/* 카테고리 내 메뉴 — 좌측 컬러 띠로 그룹 시각화 */}
              {isOpen && !collapsed && (
                <div
                  className={`space-y-0.5 mt-0.5 ml-3 pl-2 border-l-2 ${
                    isActiveCategory ? "border-accent" : "border-blue-100"
                  }`}
                >
                  {cat.items.map((key) => {
                    const item = menuByKey.get(key);
                    if (!item) return null;
                    return renderMenuItem(item);
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* 미분류 항목 */}
        {uncategorized.length > 0 && (
          <div>
            <div className="px-2 py-1.5 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
              {!collapsed ? "기타" : <MoreHorizontal size={16} className="mx-auto" />}
            </div>
            {!collapsed && (
              <div className="space-y-0.5 mb-1">
                {uncategorized.map((item) => renderMenuItem(item))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* User Info */}
      <div className="border-t border-border-default p-3">
        {!collapsed && (
          <div className="mb-2">
            <div className="text-body font-medium text-text-primary truncate">
              {user?.name}
            </div>
            <div className="text-caption text-text-tertiary">
              {roleLabel[user?.role || ""] || user?.role}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-2 text-caption text-text-tertiary hover:text-status-error transition-colors"
        >
          <LogOut size={16} />
          {!collapsed && <span>로그아웃</span>}
        </button>
      </div>
    </aside>
  );
}
