"use client";

/**
 * 권한 그룹 탭 — 그룹 카드 목록 + 그룹 편집 모달 (권한 + 멤버).
 */

import { useCallback, useEffect, useState } from "react";
import { Edit3, Trash2, Check, X, Layers } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { UserSearchInput } from "@/components/admin/UserSearchInput";
import type { PermissionItem } from "./types";


export function PermissionGroupsTab() {
  const { isSuperAdmin } = useAuth();
  const [groups, setGroups] = useState<any[]>([]);
  const [allPerms, setAllPerms] = useState<Record<string, PermissionItem[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editing, setEditing] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [gs, ps] = await Promise.all([
        api.get<{ groups: any[] }>("/api/permissions/groups"),
        api.get<{ categories: Record<string, PermissionItem[]> }>("/api/permissions"),
      ]);
      setGroups(gs.groups);
      setAllPerms(ps.categories);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const createGroup = async () => {
    if (!newName.trim()) return;
    try {
      await api.post("/api/permissions/groups", {
        name: newName,
        description: newDesc,
        permissions: [],
      });
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      fetchAll();
    } catch (err: any) {
      alert(err?.detail || "생성 실패");
    }
  };

  const remove = async (g: any) => {
    if (!isSuperAdmin) {
      alert("그룹 삭제는 최고관리자만 가능합니다");
      return;
    }
    if (!confirm(`'${g.name}' 그룹을 삭제하시겠습니까?\n할당된 사용자의 권한이 즉시 회수됩니다.`)) return;
    try {
      await api.delete(`/api/permissions/groups/${g.id}`);
      fetchAll();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-body font-semibold text-text-primary">권한 그룹</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-accent text-white text-caption rounded hover:bg-accent-hover"
        >
          + 그룹 생성
        </button>
      </div>

      <div className="mb-4 p-3 bg-cream-100 border border-cream-300 rounded text-caption text-text-secondary">
        권한 그룹은 <b>학기 무관</b>의 영구 권한 묶음입니다. 같은 권한을 자주 부여하는
        경우 그룹으로 묶어두면 사용자별 부여가 쉬워집니다.
        학기 단위로 자동 회수되는 권한은 <b>{`'직책 권한 (학기)'`}</b> 탭을 사용하세요.
      </div>

      {showCreate && (
        <div className="mb-4 p-4 bg-bg-primary rounded-lg border border-border-default">
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="그룹 이름"
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="설명 (선택)"
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
            />
            <div className="flex gap-2">
              <button onClick={createGroup} className="px-4 py-1.5 bg-accent text-white text-body rounded">
                생성
              </button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-border-default text-body rounded">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((g) => (
          <div
            key={g.id}
            className="bg-bg-primary rounded-lg border border-border-default p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start justify-between mb-1">
              <div className="text-body font-medium text-text-primary">{g.name}</div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditing(g.id)}
                  title="권한·멤버 편집"
                  className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent"
                >
                  <Edit3 size={13} />
                </button>
                <button
                  onClick={() => remove(g)}
                  title={isSuperAdmin ? "삭제" : "최고관리자만 삭제"}
                  disabled={!isSuperAdmin}
                  className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {g.description && (
              <div className="text-caption text-text-tertiary mt-1 mb-2">{g.description}</div>
            )}
            <div className="text-caption text-accent">{g.permission_count}개 권한</div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="col-span-full text-center py-8 text-body text-text-tertiary">
            권한 그룹이 없습니다
          </div>
        )}
      </div>

      {editing !== null && (
        <PermissionGroupEditModal
          groupId={editing}
          allPerms={allPerms}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}


function PermissionGroupEditModal({
  groupId, allPerms, onClose, onSaved,
}: {
  groupId: number;
  allPerms: Record<string, PermissionItem[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/permissions/groups/${groupId}`);
      setDetail(d);
      setName(d.name || "");
      setDescription(d.description || "");
      setSelectedKeys(new Set(d.permissions || []));
    } catch (err: any) {
      alert(err?.detail || "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const togglePerm = (k: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const saveGroup = async () => {
    setSaving(true);
    try {
      await api.put(`/api/permissions/groups/${groupId}`, {
        name: name.trim(),
        description: description.trim() || null,
        permissions: Array.from(selectedKeys),
      });
      onSaved();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const assignUser = async (u: { id: number; name: string }) => {
    try {
      await api.post(`/api/permissions/groups/${groupId}/assign`, { user_id: u.id });
      await load();
      setShowAddUser(false);
    } catch (err: any) {
      alert(err?.detail || "할당 실패");
    }
  };

  const removeMember = async (uid: number, name: string) => {
    if (!confirm(`${name}님을 이 그룹에서 제외하시겠습니까?\n해당 사용자가 이 그룹을 통해 받던 권한이 즉시 회수됩니다.`)) return;
    try {
      await api.delete(`/api/permissions/groups/${groupId}/members/${uid}`);
      await load();
    } catch (err: any) {
      alert(err?.detail || "제거 실패");
    }
  };

  // 권한 검색 필터
  const filtered: Record<string, PermissionItem[]> = {};
  for (const [cat, perms] of Object.entries(allPerms)) {
    const matched = perms.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.key.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q);
    });
    if (matched.length > 0) filtered[cat] = matched;
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`그룹 편집: ${detail?.name || ""}`}
      icon={<Layers size={18} />}
      maxWidth="2xl"
    >
      {loading || !detail ? (
        <div className="py-8 text-center text-text-tertiary">로딩 중...</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption text-text-secondary mb-1">이름 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">설명</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          </div>

          {/* 권한 트리 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-caption text-text-secondary">
                포함된 권한 ({selectedKeys.size}개)
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="검색..."
                className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary w-48"
              />
            </div>
            <div className="border border-border-default rounded max-h-72 overflow-y-auto">
              {Object.entries(filtered).map(([cat, perms]) => (
                <div key={cat}>
                  <div className="bg-bg-tertiary px-3 py-1.5 text-caption font-semibold text-text-secondary sticky top-0">
                    {cat}
                  </div>
                  {perms.map((p) => {
                    const checked = selectedKeys.has(p.key);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2 px-3 py-1.5 border-t border-border-default cursor-pointer hover:bg-bg-secondary ${
                          p.super_admin_only ? "opacity-40" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => !p.super_admin_only && togglePerm(p.key)}
                          disabled={p.super_admin_only}
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-body text-text-primary">{p.display_name}</div>
                          <div className="text-caption text-text-tertiary truncate">{p.key}</div>
                        </div>
                        {p.super_admin_only && (
                          <span className="text-caption text-status-error" title="최고관리자 전용">SA</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))}
              {Object.keys(filtered).length === 0 && (
                <div className="px-3 py-6 text-center text-caption text-text-tertiary">
                  검색 결과 없음
                </div>
              )}
            </div>
          </div>

          {/* 멤버 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-caption text-text-secondary">
                할당된 사용자 ({detail.members.length}명)
              </label>
              <button
                onClick={() => setShowAddUser(!showAddUser)}
                className="text-caption text-accent hover:underline"
              >
                + 사용자 추가
              </button>
            </div>
            {showAddUser && (
              <div className="mb-2">
                <UserSearchInput
                  value=""
                  onSelect={(u) => u && assignUser(u)}
                  placeholder="추가할 사용자 검색..."
                  excludeUserIds={new Set(detail.members.map((m: any) => m.id))}
                />
              </div>
            )}
            <div className="border border-border-default rounded max-h-48 overflow-y-auto">
              {detail.members.length === 0 ? (
                <div className="px-3 py-4 text-caption text-text-tertiary text-center">
                  할당된 사용자 없음
                </div>
              ) : (
                detail.members.map((m: any) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3 py-1.5 border-t border-border-default first:border-t-0 hover:bg-bg-secondary"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-body text-text-primary">{m.name}</div>
                      <div className="text-caption text-text-tertiary truncate">
                        {m.email} · {m.role}
                      </div>
                    </div>
                    <button
                      onClick={() => removeMember(m.id, m.name)}
                      title="이 사용자를 그룹에서 제거"
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-status-error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <ModalFooter>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          <X size={14} /> 닫기
        </button>
        <button
          onClick={saveGroup}
          disabled={saving || loading}
          className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Check size={14} />
          {saving ? "저장 중..." : "권한·이름 저장"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
