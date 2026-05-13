"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { Shield, Users, Layers, Save, Lock } from "lucide-react";

type Tab = "matrix" | "admins" | "groups";

interface MatrixRow {
  id: number;
  key: string;
  display_name: string;
  category: string;
  requires_2fa: boolean;
  super_admin_only: boolean;
  [role: string]: any;
}

export default function PermissionsPage() {
  const { isSuperAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("matrix");

  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">권한 관리</h1>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 bg-bg-secondary rounded-lg p-1 w-fit">
        <TabButton active={tab === "matrix"} onClick={() => setTab("matrix")} icon={Shield} label="역할별 기본값" />
        <TabButton active={tab === "admins"} onClick={() => setTab("admins")} icon={Users} label="지정관리자" />
        <TabButton active={tab === "groups"} onClick={() => setTab("groups")} icon={Layers} label="권한 그룹" />
      </div>

      {tab === "matrix" && <PermissionMatrix />}
      {tab === "admins" && <DesignatedAdmins />}
      {tab === "groups" && <PermissionGroups />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-body rounded transition-colors ${
        active
          ? "bg-bg-primary text-accent font-medium shadow-sm"
          : "text-text-secondary hover:text-text-primary"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

// ── 탭1: 역할별 권한 매트릭스 ──
function PermissionMatrix() {
  const { isSuperAdmin } = useAuth();
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/permissions/matrix");
      setMatrix(data.matrix);
      setRoles(data.roles);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  const togglePermission = (rowIdx: number, role: string) => {
    const row = matrix[rowIdx];
    if (row.super_admin_only && !isSuperAdmin) return;
    if (role === "super_admin" || role === "designated_admin") return;

    setMatrix((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [role]: !next[rowIdx][role] };
      return next;
    });
    setDirty(true);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const role of roles) {
        if (role === "super_admin" || role === "designated_admin") continue;
        const keys = matrix.filter((r) => r[role]).map((r) => r.key);
        await api.put(`/api/permissions/roles/${role}`, { permissions: keys });
      }
      setDirty(false);
      alert("저장 완료");
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const ROLE_LABELS: Record<string, string> = {
    designated_admin: "지정관리자",
    teacher: "교사",
    staff: "직원",
    student: "학생",
  };

  // 카테고리별 그룹핑
  const categories = new Map<string, MatrixRow[]>();
  for (const row of matrix) {
    const cat = row.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(row);
  }

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;

  return (
    <div>
      {dirty && (
        <div className="flex items-center justify-between mb-4 p-3 bg-accent-light rounded-lg">
          <span className="text-body text-accent">변경사항이 있습니다</span>
          <button
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 bg-accent text-white rounded text-body hover:bg-accent-hover disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      )}

      <div className="bg-bg-primary rounded-lg border border-border-default overflow-x-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-bg-secondary z-10">
            <tr>
              <th className="px-4 py-3 text-left text-caption text-text-tertiary font-medium w-64">권한</th>
              {roles.map((role) => (
                <th key={role} className="px-4 py-3 text-center text-caption text-text-tertiary font-medium w-24">
                  {ROLE_LABELS[role] || role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(categories.entries()).map(([cat, rows]) => (
              <>
                <tr key={`cat-${cat}`} className="bg-bg-tertiary">
                  <td colSpan={roles.length + 1} className="px-4 py-2 text-caption font-semibold text-text-secondary">
                    {cat}
                  </td>
                </tr>
                {rows.map((row) => {
                  const rowIdx = matrix.indexOf(row);
                  return (
                    <tr key={row.key} className="border-t border-border-default hover:bg-bg-secondary">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-body text-text-primary">{row.display_name}</span>
                          {row.requires_2fa && (
                            <Lock size={12} className="text-status-warning" title="2FA 필요" />
                          )}
                          {row.super_admin_only && (
                            <span className="text-caption text-status-error" title="최고관리자 전용">SA</span>
                          )}
                        </div>
                        <div className="text-caption text-text-tertiary">{row.key}</div>
                      </td>
                      {roles.map((role) => {
                        const isAdminRole = role === "super_admin" || role === "designated_admin";
                        const isLocked = row.super_admin_only && !isSuperAdmin;
                        const checked = isAdminRole ? true : row[role];

                        return (
                          <td key={role} className="px-4 py-2 text-center">
                            <button
                              onClick={() => !isAdminRole && !isLocked && togglePermission(rowIdx, role)}
                              disabled={isAdminRole || isLocked}
                              className={`w-8 h-5 rounded-full relative transition-colors ${
                                checked
                                  ? "bg-accent"
                                  : "bg-gray-200"
                              } ${isAdminRole || isLocked ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              <span
                                className={`block w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${
                                  checked ? "left-4" : "left-0.5"
                                }`}
                              />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 탭2: 지정관리자 관리 ──
function DesignatedAdmins() {
  const [admins, setAdmins] = useState<any[]>([]);
  const [selectedAdmin, setSelectedAdmin] = useState<number | null>(null);
  const [adminPerms, setAdminPerms] = useState<any>(null);

  useEffect(() => {
    api.get("/api/users?role=designated_admin&per_page=100").then((data) => {
      setAdmins(data.items);
    }).catch(() => {});
  }, []);

  const selectAdmin = async (userId: number) => {
    setSelectedAdmin(userId);
    try {
      const data = await api.get(`/api/permissions/users/${userId}`);
      setAdminPerms(data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-1">
        <h3 className="text-body font-semibold text-text-primary mb-3">지정관리자 목록</h3>
        <div className="bg-bg-primary rounded-lg border border-border-default">
          {admins.length === 0 && (
            <div className="p-4 text-caption text-text-tertiary">
              지정관리자가 없습니다. 사용자 관리에서 역할을 변경하세요.
            </div>
          )}
          {admins.map((admin) => (
            <button
              key={admin.id}
              onClick={() => selectAdmin(admin.id)}
              className={`w-full text-left px-4 py-3 border-b border-border-default hover:bg-bg-secondary transition-colors ${
                selectedAdmin === admin.id ? "bg-accent-light" : ""
              }`}
            >
              <div className="text-body text-text-primary">{admin.name}</div>
              <div className="text-caption text-text-tertiary">{admin.email}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-2">
        {adminPerms ? (
          <div>
            <h3 className="text-body font-semibold text-text-primary mb-3">
              유효 권한 ({adminPerms.effective_permissions.length}개)
            </h3>
            <div className="bg-bg-primary rounded-lg border border-border-default p-4">
              <p className="text-caption text-text-tertiary mb-3">
                지정관리자는 최고관리자 전용 권한을 제외한 모든 권한에 자동 접근합니다.
                교사/직원/학생의 역할별 권한을 관리할 수 있습니다.
              </p>
              {adminPerms.permission_groups.length > 0 && (
                <div className="mb-3">
                  <div className="text-caption font-medium text-text-secondary mb-1">할당된 그룹:</div>
                  {adminPerms.permission_groups.map((g: any) => (
                    <span key={g.id} className="inline-block px-2 py-0.5 mr-1 mb-1 bg-accent-light text-accent text-caption rounded">
                      {g.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-caption text-text-tertiary">
                총 {adminPerms.effective_permissions.length}개 권한 활성
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 text-text-tertiary text-body">
            좌측에서 지정관리자를 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}

// ── 탭3: 권한 그룹 ──
function PermissionGroups() {
  const [groups, setGroups] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    api.get("/api/permissions/groups").then((data) => {
      setGroups(data.groups);
    }).catch(() => {});
  }, []);

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
      const data = await api.get("/api/permissions/groups");
      setGroups(data.groups);
    } catch (err: any) {
      alert(err?.detail || "생성 실패");
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
          <div key={g.id} className="bg-bg-primary rounded-lg border border-border-default p-4">
            <div className="text-body font-medium text-text-primary">{g.name}</div>
            {g.description && (
              <div className="text-caption text-text-tertiary mt-1">{g.description}</div>
            )}
            <div className="mt-2 text-caption text-accent">
              {g.permission_count}개 권한
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="col-span-full text-center py-8 text-body text-text-tertiary">
            권한 그룹이 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
