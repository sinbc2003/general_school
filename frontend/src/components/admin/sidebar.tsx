"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, LogOut, Menu, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useMenuSettings } from "@/lib/menu-context";
import { useSidebar } from "@/lib/sidebar-context";
import { adminMenu, type MenuItem } from "@/config/admin-menu";
import { iconMap, type MenuCategory } from "@/config/menu-categories";

export function AdminSidebar() {
  const { user, logout, hasPermission, isSuperAdmin } = useAuth();
  const { categories, isHidden } = useMenuSettings();
  const { collapsed, toggle: toggleCollapsed } = useSidebar();
  const pathname = usePathname();
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    new Set(["work", "teaching", "competition", "guidance", "activity", "search", "ai", "student-view", "management"])
  );
  const [openSubmenus, setOpenSubmenus] = useState<Set<string>>(new Set());

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
      const isOpen = openSubmenus.has(item.key);
      const parentActive = item.children.some((c) => c.path && isActive(c.path));
      return (
        <div key={item.key}>
          <button
            onClick={() => toggleSubmenu(item.key)}
            className={`w-full flex items-center gap-2 ${indentPx} pr-2 py-2 text-[13.5px] rounded transition-colors ${
              parentActive
                ? "text-accent font-medium"
                : "text-text-primary hover:bg-bg-secondary"
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
            <div className="space-y-0.5 mt-0.5">
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

      {/* Menu — 카테고리별 그룹 */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {categories.admin.map((cat) => {
          if (!categoryHasVisibleItems(cat)) return null;

          const CatIcon = iconMap[cat.icon] || MoreHorizontal;
          const isOpen = openCategories.has(cat.id);

          return (
            <div key={cat.id}>
              {/* 카테고리 헤더 */}
              <button
                onClick={() => toggleCategory(cat.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11.5px] font-bold text-text-secondary uppercase tracking-wide hover:text-text-primary transition-colors"
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

              {/* 카테고리 내 메뉴 */}
              {isOpen && !collapsed && (
                <div className="space-y-0.5 mb-1">
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
