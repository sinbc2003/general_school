"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GripVertical,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Save,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useMenuSettings } from "@/lib/menu-context";
import { adminMenu } from "@/config/admin-menu";
import { studentMenu } from "@/config/student-menu";
import {
  iconMap,
  defaultCategories,
  type MenuCategory,
  type MenuCategoriesConfig,
} from "@/config/menu-categories";

type Target = "admin" | "student";

export default function MenuManagePage() {
  const { isAdmin } = useAuth();
  const { categories, saveCategories, hiddenMenus, toggleMenu, isHidden } =
    useMenuSettings();

  const [tab, setTab] = useState<Target>("admin");
  const [local, setLocal] = useState<MenuCategoriesConfig>(categories);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [newCatName, setNewCatName] = useState("");

  // categories 변경 시 local 동기화
  useEffect(() => {
    setLocal(categories);
    setDirty(false);
  }, [categories]);

  const allMenuItems = tab === "admin" ? adminMenu : studentMenu;
  const menuByKey = new Map(allMenuItems.map((m) => [m.key, m]));
  const cats = local[tab];

  const setCats = useCallback(
    (fn: (prev: MenuCategory[]) => MenuCategory[]) => {
      setLocal((prev) => ({ ...prev, [tab]: fn(prev[tab]) }));
      setDirty(true);
    },
    [tab]
  );

  const toggleExpand = (id: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // 카테고리에 속한 모든 item key
  const assignedKeys = new Set(cats.flatMap((c) => c.items));

  // 미분류 항목
  const unassigned = allMenuItems.filter((m) => !assignedKeys.has(m.key));

  // ── 카테고리 CRUD ──

  const addCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    const id = `custom_${Date.now()}`;
    setCats((prev) => [...prev, { id, name, icon: "Briefcase", items: [] }]);
    setNewCatName("");
  };

  const removeCategory = (id: string) => {
    setCats((prev) => prev.filter((c) => c.id !== id));
  };

  const renameCategory = (id: string, name: string) => {
    setCats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c))
    );
  };

  const changeCategoryIcon = (id: string, icon: string) => {
    setCats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, icon } : c))
    );
  };

  // ── 항목 이동 ──

  const addItemToCategory = (catId: string, itemKey: string) => {
    setCats((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, items: [...c.items, itemKey] } : c
      )
    );
  };

  const removeItemFromCategory = (catId: string, itemKey: string) => {
    setCats((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, items: c.items.filter((k) => k !== itemKey) }
          : c
      )
    );
  };

  const moveItem = (catId: string, itemKey: string, dir: -1 | 1) => {
    setCats((prev) =>
      prev.map((c) => {
        if (c.id !== catId) return c;
        const idx = c.items.indexOf(itemKey);
        if (idx < 0) return c;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= c.items.length) return c;
        const items = [...c.items];
        [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
        return { ...c, items };
      })
    );
  };

  // ── 카테고리 순서 ──

  const moveCategory = (id: string, dir: -1 | 1) => {
    setCats((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  // ── 저장 / 초기화 ──

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCategories(local);
      setDirty(false);
    } catch {
      // error handled in context
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLocal(defaultCategories);
    setDirty(true);
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-text-secondary">관리자 권한이 필요합니다.</div>
    );
  }

  const iconNames = Object.keys(iconMap);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">메뉴 관리</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 text-[13px] border border-border-default rounded hover:bg-bg-secondary transition-colors text-text-secondary"
          >
            <RotateCcw size={14} /> 기본값 복원
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`flex items-center gap-1 px-4 py-1.5 text-[13px] rounded font-medium transition-colors ${
              dirty
                ? "bg-accent text-white hover:bg-accent/90"
                : "bg-bg-secondary text-text-tertiary cursor-not-allowed"
            }`}
          >
            <Save size={14} /> {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 bg-bg-secondary rounded-lg p-1 w-fit">
        {(["admin", "student"] as Target[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-[13px] rounded-md transition-colors ${
              tab === t
                ? "bg-bg-primary text-text-primary font-medium shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {t === "admin" ? "교사/관리자" : "학생"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 왼쪽: 카테고리 목록 */}
        <div className="lg:col-span-2 space-y-3">
          {cats.map((cat, catIdx) => {
            const CatIcon = iconMap[cat.icon];
            const isOpen = expandedCats.has(cat.id);

            return (
              <div
                key={cat.id}
                className="bg-bg-primary border border-border-default rounded-lg"
              >
                {/* 카테고리 헤더 */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
                  <button
                    onClick={() => toggleExpand(cat.id)}
                    className="text-text-tertiary hover:text-text-primary"
                  >
                    {isOpen ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                  {CatIcon && <CatIcon size={16} className="text-accent" />}
                  <input
                    value={cat.name}
                    onChange={(e) => renameCategory(cat.id, e.target.value)}
                    className="flex-1 bg-transparent text-body font-medium text-text-primary outline-none border-b border-transparent focus:border-accent transition-colors"
                  />
                  <span className="text-[11px] text-text-tertiary">
                    {cat.items.length}개
                  </span>

                  {/* 순서 이동 */}
                  <button
                    onClick={() => moveCategory(cat.id, -1)}
                    disabled={catIdx === 0}
                    className="text-text-tertiary hover:text-text-primary disabled:opacity-30 text-[13px] px-1"
                    title="위로"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveCategory(cat.id, 1)}
                    disabled={catIdx === cats.length - 1}
                    className="text-text-tertiary hover:text-text-primary disabled:opacity-30 text-[13px] px-1"
                    title="아래로"
                  >
                    ▼
                  </button>

                  {/* 아이콘 변경 */}
                  <select
                    value={cat.icon}
                    onChange={(e) => changeCategoryIcon(cat.id, e.target.value)}
                    className="text-[11px] bg-bg-secondary border border-border-default rounded px-1 py-0.5 text-text-secondary"
                  >
                    {iconNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>

                  {/* 삭제 */}
                  <button
                    onClick={() => removeCategory(cat.id)}
                    className="text-text-tertiary hover:text-status-error transition-colors p-1"
                    title="카테고리 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* 카테고리 내 항목 */}
                {isOpen && (
                  <div className="p-3 space-y-1">
                    {cat.items.length === 0 && (
                      <div className="text-[12px] text-text-tertiary py-2 text-center">
                        항목 없음 — 오른쪽에서 추가하세요
                      </div>
                    )}
                    {cat.items.map((key, itemIdx) => {
                      const item = menuByKey.get(key);
                      const hidden = isHidden(key);
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary rounded group"
                        >
                          <GripVertical
                            size={14}
                            className="text-text-tertiary"
                          />
                          {item ? (
                            <>
                              <item.icon size={15} className="text-text-secondary" />
                              <span className="flex-1 text-[13px] text-text-primary">
                                {item.label}
                              </span>
                            </>
                          ) : (
                            <span className="flex-1 text-[13px] text-text-tertiary italic">
                              {key} (삭제됨)
                            </span>
                          )}

                          {/* 숨김 토글 */}
                          <button
                            onClick={() => toggleMenu(key)}
                            className={`p-1 rounded transition-colors ${
                              hidden
                                ? "text-status-error hover:text-text-primary"
                                : "text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100"
                            }`}
                            title={hidden ? "숨김 해제" : "숨기기"}
                          >
                            {hidden ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>

                          {/* 순서 */}
                          <button
                            onClick={() => moveItem(cat.id, key, -1)}
                            disabled={itemIdx === 0}
                            className="text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-30 opacity-0 group-hover:opacity-100"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveItem(cat.id, key, 1)}
                            disabled={itemIdx === cat.items.length - 1}
                            className="text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-30 opacity-0 group-hover:opacity-100"
                          >
                            ▼
                          </button>

                          {/* 제거 */}
                          <button
                            onClick={() =>
                              removeItemFromCategory(cat.id, key)
                            }
                            className="text-text-tertiary hover:text-status-error opacity-0 group-hover:opacity-100 transition-colors p-1"
                            title="카테고리에서 제거"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* 카테고리 추가 */}
          <div className="flex items-center gap-2 p-3 border border-dashed border-border-default rounded-lg">
            <Plus size={16} className="text-text-tertiary" />
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              placeholder="새 카테고리 이름"
              className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <button
              onClick={addCategory}
              disabled={!newCatName.trim()}
              className="px-3 py-1 text-[12px] bg-accent text-white rounded disabled:opacity-40 hover:bg-accent/90 transition-colors"
            >
              추가
            </button>
          </div>
        </div>

        {/* 오른쪽: 미분류 항목 풀 */}
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h3 className="text-body font-semibold text-text-primary mb-3">
            미분류 항목
          </h3>
          {unassigned.length === 0 ? (
            <div className="text-[12px] text-text-tertiary py-4 text-center">
              모든 항목이 카테고리에 배정됨
            </div>
          ) : (
            <div className="space-y-1">
              {unassigned.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded group"
                >
                  <item.icon size={15} className="text-text-secondary" />
                  <span className="flex-1 text-[13px] text-text-primary">
                    {item.label}
                  </span>
                  {/* 카테고리에 추가 드롭다운 */}
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        addItemToCategory(e.target.value, item.key);
                        e.target.value = "";
                      }
                    }}
                    className="text-[11px] bg-bg-primary border border-border-default rounded px-1.5 py-0.5 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <option value="">+ 추가</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* 전체 메뉴 숨김 상태 */}
          <h3 className="text-body font-semibold text-text-primary mt-6 mb-3">
            메뉴 숨김 상태
          </h3>
          <div className="space-y-1">
            {allMenuItems.map((item) => {
              const hidden = isHidden(item.key);
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-bg-secondary transition-colors"
                >
                  <item.icon size={14} className="text-text-tertiary" />
                  <span
                    className={`flex-1 text-[12px] ${
                      hidden
                        ? "text-text-tertiary line-through"
                        : "text-text-primary"
                    }`}
                  >
                    {item.label}
                  </span>
                  <button
                    onClick={() => toggleMenu(item.key)}
                    className={`p-0.5 rounded ${
                      hidden
                        ? "text-status-error"
                        : "text-status-success"
                    }`}
                  >
                    {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
