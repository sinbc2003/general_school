"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import {
  defaultCategories,
  type MenuCategory,
  type MenuCategoriesConfig,
} from "@/config/menu-categories";

interface MenuContextValue {
  hiddenMenus: string[];
  loading: boolean;
  toggleMenu: (key: string) => Promise<void>;
  isHidden: (key: string) => boolean;
  refresh: () => Promise<void>;
  // 카테고리
  categories: MenuCategoriesConfig;
  saveCategories: (cats: MenuCategoriesConfig) => Promise<void>;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const [hiddenMenus, setHiddenMenus] = useState<string[]>([]);
  const [categories, setCategories] = useState<MenuCategoriesConfig>(defaultCategories);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const [menuData, catData] = await Promise.all([
        api.get("/api/system/menu-settings").catch(() => null),
        api.get("/api/system/menu-categories").catch(() => null),
      ]);
      if (menuData) setHiddenMenus(menuData.hidden_menus || []);
      if (catData?.admin && catData?.student) {
        setCategories(catData as MenuCategoriesConfig);
      }
    } catch {
      // 실패 시 기본값 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const toggleMenu = useCallback(async (key: string) => {
    const next = hiddenMenus.includes(key)
      ? hiddenMenus.filter((k) => k !== key)
      : [...hiddenMenus, key];
    try {
      await api.put("/api/system/menu-settings", { hidden_menus: next });
      setHiddenMenus(next);
    } catch (err: any) {
      alert(err?.detail || "설정 저장 실패");
    }
  }, [hiddenMenus]);

  const isHidden = useCallback(
    (key: string) => hiddenMenus.includes(key),
    [hiddenMenus]
  );

  const saveCategories = useCallback(async (cats: MenuCategoriesConfig) => {
    try {
      await api.put("/api/system/menu-categories", cats);
      setCategories(cats);
    } catch (err: any) {
      alert(err?.detail || "카테고리 저장 실패");
      throw err;
    }
  }, []);

  return (
    <MenuContext.Provider
      value={{
        hiddenMenus,
        loading,
        toggleMenu,
        isHidden,
        refresh: fetchSettings,
        categories,
        saveCategories,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export function useMenuSettings() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("useMenuSettings must be used within MenuProvider");
  return ctx;
}
