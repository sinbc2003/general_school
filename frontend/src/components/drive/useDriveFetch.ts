"use client";

/**
 * DrivePage 데이터 fetch hook — items/folders/breadcrumb/info + favorites 모음.
 *
 * - trashMode / currentFolderId에 따라 자동 refetch
 * - 휴지통 모드: 자료만 (폴더·breadcrumb 없음)
 * - 일반 모드: 현재 폴더의 직속 폴더 + 자료 + breadcrumb
 *
 * 반환:
 *   - items, folders, breadcrumb, info: drive state
 *   - loading, error
 *   - fetchAll: 수동 refetch (await 가능)
 *   - favoritesSet, toggleFavorite: 즐겨찾기 관리
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { FolderNode } from "./FolderSidebar";
import type { DriveItem, DriveInfo, ItemType } from "./_drive-shared";

interface Crumb { id: number; name: string }

export function useDriveFetch(params: {
  trashMode: boolean;
  currentFolderId: number | null;
}) {
  const { trashMode, currentFolderId } = params;

  const [items, setItems] = useState<DriveItem[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [info, setInfo] = useState<DriveInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 휴지통: 자료만 (폴더 없음, breadcrumb 없음)
      if (trashMode) {
        const [i, list] = await Promise.all([
          api.get<DriveInfo>("/api/drive/me"),
          api.get<{ items: DriveItem[] }>(`/api/drive/items?trash=true&type=all`),
        ]);
        setInfo(i);
        setItems(list.items);
        setFolders([]);
        setBreadcrumb([]);
        return;
      }
      // 일반: 현재 폴더의 직속 폴더 + 직속 자료 + breadcrumb
      const itemsQS =
        currentFolderId === null ? "&no_folder=true" : `&folder_id=${currentFolderId}`;
      const folderParent = currentFolderId === null ? 0 : currentFolderId; // 0 → IS NULL
      const promises: Promise<any>[] = [
        api.get<DriveInfo>("/api/drive/me"),
        api.get<{ items: DriveItem[] }>(
          `/api/drive/items?trash=false&type=all${itemsQS}`
        ),
        api.get<{ items: FolderNode[] }>(`/api/drive/folders?parent_id=${folderParent}`),
      ];
      if (currentFolderId !== null) {
        promises.push(
          api.get<{ breadcrumb: Crumb[] }>(
            `/api/drive/folders/${currentFolderId}`
          )
        );
      }
      const [i, list, foldersR, detail] = await Promise.all(promises);
      setInfo(i);
      setItems(list.items);
      setFolders(foldersR.items);
      setBreadcrumb(detail?.breadcrumb || []);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [trashMode, currentFolderId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 즐겨찾기 — backend list 후 set으로 보관
  const [favoritesSet, setFavoritesSet] = useState<Set<string>>(new Set());
  const fetchFavorites = useCallback(async () => {
    try {
      const r = await api.get<{ items: { type: ItemType; id: number }[] }>("/api/drive/favorites");
      setFavoritesSet(new Set(r.items.map((x) => `${x.type}:${x.id}`)));
    } catch {
      setFavoritesSet(new Set());
    }
  }, []);
  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  const toggleFavorite = useCallback(async (it: DriveItem) => {
    const key = `${it.type}:${it.id}`;
    try {
      const r = await api.post<{ favorited: boolean }>(`/api/drive/items/${it.type}/${it.id}/favorite`, {});
      setFavoritesSet((prev) => {
        const next = new Set(prev);
        if (r.favorited) next.add(key);
        else next.delete(key);
        return next;
      });
    } catch (e: any) {
      alert(e?.detail || e?.message || "즐겨찾기 실패");
    }
  }, []);

  return {
    items, folders, breadcrumb, info,
    loading, error,
    fetchAll,
    favoritesSet, toggleFavorite,
  };
}
