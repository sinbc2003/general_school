"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { Shield, Users, Layers, Save, Lock, Briefcase, Plus, Edit3, Trash2, Check, X, Building2, Search, LogOut, Eye } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { PositionApplyToDepartmentModal } from "@/components/admin/PositionApplyToDepartmentModal";
import { UserSearchInput } from "@/components/admin/UserSearchInput";

type Tab = "matrix" | "admins" | "groups" | "positions" | "inspect";

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
      <div className="flex gap-1 mb-6 bg-bg-secondary rounded-lg p-1 w-fit flex-wrap">
        <TabButton active={tab === "matrix"} onClick={() => setTab("matrix")} icon={Shield} label="역할별 기본값" />
        <TabButton active={tab === "positions"} onClick={() => setTab("positions")} icon={Briefcase} label="직책 권한 (학기)" />
        <TabButton active={tab === "inspect"} onClick={() => setTab("inspect")} icon={Eye} label="사용자 권한 검사" />
        <TabButton active={tab === "admins"} onClick={() => setTab("admins")} icon={Users} label="지정관리자" />
        <TabButton active={tab === "groups"} onClick={() => setTab("groups")} icon={Layers} label="권한 그룹" />
      </div>

      {tab === "matrix" && <PermissionMatrix />}
      {tab === "positions" && <PositionTemplates />}
      {tab === "inspect" && <UserInspect />}
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
  const { isSuperAdmin, user } = useAuth();
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // 지정관리자 모드 (full/scoped) — full이면 designated_admin 컬럼 토글 비활성
  const [designatedMode, setDesignatedMode] = useState<"full" | "scoped">("full");
  const [modeChanging, setModeChanging] = useState(false);
  // admin 2FA 강제 정책
  const [admin2faRequired, setAdmin2faRequired] = useState(false);
  const [admin2faChanging, setAdmin2faChanging] = useState(false);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/permissions/matrix");
      setMatrix(data.matrix);
      setRoles(data.roles);
      if (data.designated_admin_mode) {
        setDesignatedMode(data.designated_admin_mode);
      }
      // admin 2FA 정책 (super_admin만 endpoint 접근 가능)
      if (isSuperAdmin) {
        try {
          const policy = await api.get<{ required: boolean }>("/api/permissions/policy/admin-2fa-required");
          setAdmin2faRequired(policy.required);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  const toggleAdmin2fa = async () => {
    const newVal = !admin2faRequired;
    if (newVal && !user?.totp_enabled) {
      alert(
        "본인의 2FA를 먼저 등록해야 합니다. (로그아웃 후 본인 잠금 방지)\n\n" +
        "/auth/2fa-setup 에서 등록 후 다시 시도하세요.",
      );
      return;
    }
    const msg = newVal
      ? "admin 2FA 강제 정책을 켭니다.\n앞으로 super_admin/designated_admin은 2FA 미등록 시 자동으로 2FA 등록 페이지로 redirect됩니다.\n계속하시겠습니까?"
      : "admin 2FA 강제 정책을 끕니다.\n관리자가 2FA 없이도 로그인 가능합니다.\n계속하시겠습니까?";
    if (!confirm(msg)) return;
    setAdmin2faChanging(true);
    try {
      await api.put("/api/permissions/policy/admin-2fa-required", { required: newVal });
      setAdmin2faRequired(newVal);
    } catch (err: any) {
      alert(err?.detail || "정책 변경 실패");
    } finally {
      setAdmin2faChanging(false);
    }
  };

  const changeMode = async (newMode: "full" | "scoped") => {
    if (newMode === designatedMode) return;
    const msg = newMode === "scoped"
      ? "지정관리자 모드를 'scoped'로 변경합니다.\n매트릭스에서 명시 부여한 권한만 보유하게 됩니다.\n현재 활동 중인 지정관리자는 자동 로그아웃됩니다.\n계속하시겠습니까?"
      : "지정관리자 모드를 'full'로 변경합니다.\n모든 지정관리자가 (super_admin 전용 제외) 모든 권한을 자동 보유하게 됩니다.\n현재 활동 중인 지정관리자는 자동 로그아웃됩니다.\n계속하시겠습니까?";
    if (!confirm(msg)) return;
    setModeChanging(true);
    try {
      await api.put("/api/permissions/policy/designated-admin-mode", { mode: newMode });
      setDesignatedMode(newMode);
      await fetchMatrix();
      alert(`모드 변경 완료: ${newMode}`);
    } catch (err: any) {
      alert(err?.detail || "모드 변경 실패");
    } finally {
      setModeChanging(false);
    }
  };

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  const togglePermission = (rowIdx: number, role: string) => {
    const row = matrix[rowIdx];
    if (row.super_admin_only && !isSuperAdmin) return;
    if (role === "super_admin") return;
    // designated_admin은 scoped 모드 + super_admin인 경우만 토글 가능
    if (role === "designated_admin") {
      if (!isSuperAdmin || designatedMode !== "scoped") return;
      // SUPER_ADMIN_ONLY 키는 designated_admin이 가질 수 없음
      if (row.super_admin_only) return;
    }

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
        if (role === "super_admin") continue;
        // designated_admin은 super_admin + scoped 모드일 때만 저장
        if (role === "designated_admin" && (!isSuperAdmin || designatedMode !== "scoped")) {
          continue;
        }
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
    super_admin: "최고관리자",
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
      {/* 정책 카드들 (super_admin 전용) */}
      {isSuperAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {/* 지정관리자 모드 */}
          <div className="p-3 bg-cream-100 border border-cream-300 rounded-lg">
            <div className="text-caption text-text-secondary mb-1">
              <b>지정관리자 권한 모드</b>
            </div>
            <div className="text-text-tertiary text-caption mb-2">
              {designatedMode === "full"
                ? "현재: 모든 권한 자동 (최고관리자 전용 제외)"
                : "현재: 매트릭스에서 명시 부여한 권한만"}
            </div>
            <div className="flex gap-1 bg-bg-primary rounded p-0.5 w-fit">
              <button
                onClick={() => changeMode("full")}
                disabled={modeChanging || designatedMode === "full"}
                className={`px-3 py-1 text-caption rounded transition-colors ${
                  designatedMode === "full"
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                전체 (디폴트)
              </button>
              <button
                onClick={() => changeMode("scoped")}
                disabled={modeChanging || designatedMode === "scoped"}
                className={`px-3 py-1 text-caption rounded transition-colors ${
                  designatedMode === "scoped"
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                세분화
              </button>
            </div>
          </div>

          {/* admin 2FA 강제 */}
          <div className="p-3 bg-cream-100 border border-cream-300 rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="text-caption text-text-secondary mb-1">
                  <b>관리자 2FA 강제</b>
                </div>
                <div className="text-text-tertiary text-caption">
                  {admin2faRequired
                    ? "ON — 미등록 admin은 자동으로 등록 페이지로 redirect"
                    : "OFF — admin도 2FA 옵션 (보안상 ON 권장)"}
                </div>
                {!user?.totp_enabled && !admin2faRequired && (
                  <div className="text-status-warning text-caption mt-1">
                    ⚠ 본인 2FA 미등록 — 정책 켜기 전 등록 필요
                  </div>
                )}
              </div>
              <button
                onClick={toggleAdmin2fa}
                disabled={admin2faChanging}
                className={`w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ${
                  admin2faRequired ? "bg-accent" : "bg-gray-300"
                } disabled:opacity-50`}
                title={admin2faRequired ? "끄기" : "켜기"}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                    admin2faRequired ? "left-5" : "left-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

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
                            <span title="2FA 필요">
                              <Lock size={12} className="text-status-warning" />
                            </span>
                          )}
                          {row.super_admin_only && (
                            <span className="text-caption text-status-error" title="최고관리자 전용">SA</span>
                          )}
                        </div>
                        <div className="text-caption text-text-tertiary">{row.key}</div>
                      </td>
                      {roles.map((role) => {
                        const isSuperRow = role === "super_admin";
                        // designated_admin은 모드/권한에 따라 분기
                        let isAutoChecked = false;  // 토글 비활성 + 체크된 상태로 표시
                        let isTogglable = false;
                        if (isSuperRow) {
                          isAutoChecked = true;
                        } else if (role === "designated_admin") {
                          if (designatedMode === "full") {
                            // full 모드: SUPER_ADMIN_ONLY 제외 모두 자동 보유
                            isAutoChecked = !row.super_admin_only;
                          } else {
                            // scoped: super_admin만 토글 가능, SUPER_ADMIN_ONLY는 불가
                            isTogglable = isSuperAdmin && !row.super_admin_only;
                          }
                        } else {
                          isTogglable = !(row.super_admin_only && !isSuperAdmin);
                        }
                        const checked = isAutoChecked ? true : row[role];

                        return (
                          <td key={role} className="px-4 py-2 text-center">
                            <button
                              onClick={() => isTogglable && togglePermission(rowIdx, role)}
                              disabled={!isTogglable}
                              className={`w-8 h-5 rounded-full relative transition-colors ${
                                checked
                                  ? "bg-accent"
                                  : "bg-gray-200"
                              } ${!isTogglable ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                              title={
                                role === "designated_admin" && designatedMode === "full"
                                  ? "full 모드: 자동 부여 (모드를 scoped로 바꿔야 토글 가능)"
                                  : row.super_admin_only && role !== "super_admin"
                                  ? "최고관리자 전용 권한"
                                  : ""
                              }
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


// ── 탭4: 직책 권한 (학기 단위 권한 위임) ──
interface PositionTemplate {
  id: number;
  key: string;
  display_name: string;
  description: string | null;
  category: string;
  is_system: boolean;
  permission_keys: string[];
  permission_count: number;
  assignment_count: number;
}

interface PermissionItem {
  id: number;
  key: string;
  display_name: string;
  category: string;
  super_admin_only: boolean;
}

function PositionTemplates() {
  const [templates, setTemplates] = useState<PositionTemplate[]>([]);
  const [allPerms, setAllPerms] = useState<Record<string, PermissionItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PositionTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [applyToDept, setApplyToDept] = useState<{ id: number; name: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tplData, permData] = await Promise.all([
        api.get<{ items: PositionTemplate[] }>("/api/permissions/position-templates"),
        api.get<{ categories: Record<string, PermissionItem[]> }>("/api/permissions"),
      ]);
      setTemplates(tplData.items);
      setAllPerms(permData.categories);
    } catch (err: any) {
      alert(err?.detail || "로딩 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const openCreate = () => {
    setEditing({
      id: 0, key: "", display_name: "", description: "",
      category: "기타", is_system: false,
      permission_keys: [], permission_count: 0, assignment_count: 0,
    });
    setShowForm(true);
  };

  const openEdit = (t: PositionTemplate) => {
    setEditing({ ...t });
    setShowForm(true);
  };

  const remove = async (t: PositionTemplate) => {
    if (t.is_system) {
      alert("시스템 기본 템플릿은 삭제할 수 없습니다");
      return;
    }
    if (t.assignment_count > 0) {
      if (!confirm(
        `이 직책이 ${t.assignment_count}개 enrollment에 할당되어 있습니다.\n삭제하면 해당 사용자들의 권한이 즉시 회수됩니다. 계속하시겠습니까?`,
      )) return;
    } else {
      if (!confirm(`'${t.display_name}' 직책을 삭제하시겠습니까?`)) return;
    }
    try {
      await api.delete(`/api/permissions/position-templates/${t.id}`);
      fetchAll();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  // 카테고리별 그룹핑
  const byCategory = new Map<string, PositionTemplate[]>();
  for (const t of templates) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category)!.push(t);
  }

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;

  return (
    <div>
      <div className="mb-4 p-3 bg-cream-100 border border-cream-300 rounded-lg">
        <div className="text-caption text-text-secondary">
          <b>학기·직책 기반 권한 위임</b> — 학기 명단의 한 사람에게 직책을 부여하면,
          그 직책에 정의된 권한이 <b>현재 학기 동안만</b> 자동 부여됩니다. 학기가 바뀌면
          새 학기 명단에서 다시 할당해야 합니다 (자동 회수).
          업무분장이 학년도 단위라면 학기 복사 시 <code>copy_positions=True</code>로
          1→2학기 그대로 가져올 수 있습니다.
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-body font-semibold text-text-primary">
          직책 템플릿 ({templates.length}개)
        </h3>
        <button
          onClick={openCreate}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Plus size={14} />
          새 직책
        </button>
      </div>

      <div className="space-y-4">
        {Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat}>
            <h4 className="text-caption font-semibold text-text-secondary mb-2">{cat}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((t) => (
                <div
                  key={t.id}
                  className="bg-bg-primary rounded-lg border border-border-default p-3 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-medium text-text-primary">{t.display_name}</span>
                      {t.is_system && (
                        <span className="text-caption px-1.5 py-0.5 bg-cream-200 text-text-secondary rounded" title="시스템 기본">
                          기본
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setApplyToDept({ id: t.id, name: t.display_name })}
                        title="부서에 일괄 할당 (학기 단위)"
                        className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent"
                      >
                        <Building2 size={13} />
                      </button>
                      <button
                        onClick={() => openEdit(t)}
                        title="수정"
                        className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => remove(t)}
                        title={t.is_system ? "시스템 기본은 삭제 불가" : "삭제"}
                        disabled={t.is_system}
                        className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="text-caption text-text-tertiary mb-1">{t.key}</div>
                  {t.description && (
                    <div className="text-caption text-text-secondary mb-2">{t.description}</div>
                  )}
                  <div className="flex items-center gap-3 text-caption">
                    <span className="text-accent">권한 {t.permission_count}개</span>
                    <span className="text-text-tertiary">
                      할당 {t.assignment_count}건
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {templates.length === 0 && (
          <div className="text-center py-12 text-body text-text-tertiary">
            직책 템플릿이 없습니다. '+ 새 직책' 버튼으로 만드세요.
          </div>
        )}
      </div>

      {showForm && editing && (
        <PositionTemplateForm
          template={editing}
          allPerms={allPerms}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            fetchAll();
          }}
        />
      )}

      {applyToDept && (
        <PositionApplyToDepartmentModal
          open={true}
          templateId={applyToDept.id}
          templateName={applyToDept.name}
          onClose={() => setApplyToDept(null)}
          onSuccess={fetchAll}
        />
      )}
    </div>
  );
}


// ── 탭5: 사용자 권한 검사 (권한 출처 추적 + 활성 세션 + 강제 로그아웃) ──

interface PositionDetail {
  template_id: number;
  key: string;
  display_name: string;
  semester_id: number;
  semester_name: string;
  permissions: string[];
}

interface GroupDetail {
  id: number;
  name: string;
  permissions: string[];
}

interface UserPermissionsDetail {
  user_id: number;
  role: string;
  effective_permissions: string[];
  sources: {
    role: string[];
    user: string[];
    groups: GroupDetail[];
    positions: PositionDetail[];
  };
  permission_sources: Record<string, string[]>;
}

interface SessionItem {
  id: number;
  token_preview: string;
  created_at: string | null;
  expires_at: string | null;
}

interface SessionsResponse {
  user_id: number;
  user_name: string;
  active_count: number;
  items: SessionItem[];
}

function UserInspect() {
  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [perms, setPerms] = useState<UserPermissionsDetail | null>(null);
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const fetchAll = useCallback(async (uid: number) => {
    setLoading(true);
    setPerms(null);
    setSessions(null);
    try {
      const [p, s] = await Promise.all([
        api.get<UserPermissionsDetail>(`/api/permissions/users/${uid}`),
        api.get<SessionsResponse>(`/api/users/${uid}/sessions`).catch(() => null),
      ]);
      setPerms(p);
      if (s) setSessions(s);
    } catch (err: any) {
      alert(err?.detail || "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchAll(Number(selectedUserId));
    }
  }, [selectedUserId, fetchAll]);

  const forceLogout = async () => {
    if (!selectedUserId || !sessions) return;
    if (sessions.active_count === 0) return;
    if (!confirm(
      `${selectedUserName}님의 활성 세션 ${sessions.active_count}개를 모두 강제 종료합니다.\n` +
      `해당 사용자는 다음 토큰 만료(15~30분 이내) 시 강제 재로그인됩니다.\n계속하시겠습니까?`,
    )) return;
    try {
      await api.delete(`/api/users/${selectedUserId}/sessions`);
      await fetchAll(Number(selectedUserId));
      alert("세션 종료 완료");
    } catch (err: any) {
      alert(err?.detail || "강제 로그아웃 실패");
    }
  };

  // 카테고리/검색 필터링된 권한 키 목록 (출처별)
  const filteredKeys = (perms?.effective_permissions || []).filter((k) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return k.toLowerCase().includes(q);
  });

  const SourceChip = ({ src }: { src: string }) => {
    let color = "bg-bg-tertiary text-text-secondary";
    if (src.startsWith("role:")) color = "bg-blue-100 text-blue-700";
    else if (src.startsWith("position:")) color = "bg-cream-200 text-text-primary";
    else if (src.startsWith("group:")) color = "bg-purple-100 text-purple-700";
    else if (src === "user (개별 부여)") color = "bg-amber-100 text-amber-700";
    return (
      <span className={`inline-block text-caption px-1.5 py-0.5 rounded mr-1 mb-1 ${color}`}>
        {src}
      </span>
    );
  };

  return (
    <div>
      <div className="mb-4 p-3 bg-cream-100 border border-cream-300 rounded-lg">
        <div className="text-caption text-text-secondary">
          <b>사용자 권한 검사</b> — 한 사용자가 가진 모든 권한과 <b>그 권한이 어디서 왔는지</b>(역할/개별/그룹/학기 직책) 추적.
          활성 세션 확인 및 강제 로그아웃도 가능합니다.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <label className="block text-caption text-text-secondary mb-1">사용자 선택</label>
          <UserSearchInput
            value={selectedUserId}
            onSelect={(u) => {
              if (u) {
                setSelectedUserId(u.id);
                setSelectedUserName(u.name);
              } else {
                setSelectedUserId("");
                setSelectedUserName("");
                setPerms(null);
                setSessions(null);
              }
            }}
            placeholder="이름 또는 이메일로 검색..."
          />

          {sessions && (
            <div className="mt-4 p-3 bg-bg-primary border border-border-default rounded">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-body font-medium text-text-primary">활성 세션</h3>
                <span className="text-caption text-text-tertiary">
                  {sessions.active_count}개
                </span>
              </div>
              {sessions.active_count === 0 ? (
                <div className="text-caption text-text-tertiary py-2">
                  활성 세션이 없습니다 (로그아웃 상태).
                </div>
              ) : (
                <>
                  <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
                    {sessions.items.map((s) => (
                      <div key={s.id} className="text-caption border-l-2 border-cream-300 pl-2">
                        <div className="text-text-secondary font-mono">…{s.token_preview}</div>
                        <div className="text-text-tertiary">
                          발급 {s.created_at?.slice(0, 16).replace("T", " ")}
                        </div>
                        <div className="text-text-tertiary">
                          만료 {s.expires_at?.slice(0, 16).replace("T", " ")}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={forceLogout}
                    className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-caption bg-status-error text-white rounded hover:opacity-90"
                  >
                    <LogOut size={13} /> 모든 세션 강제 종료
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {loading && <div className="text-text-tertiary py-8 text-center">로딩 중...</div>}

          {!loading && !perms && (
            <div className="text-body text-text-tertiary py-16 text-center border border-dashed border-border-default rounded">
              좌측에서 사용자를 검색·선택하세요.
            </div>
          )}

          {!loading && perms && (
            <div className="space-y-4">
              {/* 요약 */}
              <div className="bg-bg-primary border border-border-default rounded p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-body font-medium text-text-primary">{selectedUserName}</span>
                    <span className="ml-2 text-caption px-2 py-0.5 bg-bg-tertiary rounded text-text-secondary">
                      {perms.role}
                    </span>
                  </div>
                  <div className="text-caption text-text-tertiary">
                    유효 권한 <b className="text-accent">{perms.effective_permissions.length}</b>개
                    {" · "}직책 <b>{perms.sources.positions.length}</b>개
                    {" · "}그룹 <b>{perms.sources.groups.length}</b>개
                    {" · "}개별 <b>{perms.sources.user.length}</b>개
                  </div>
                </div>
              </div>

              {/* 직책 상세 (학기 격리) */}
              {perms.sources.positions.length > 0 && (
                <div className="bg-bg-primary border border-border-default rounded p-3">
                  <h4 className="text-body font-medium text-text-primary mb-2">
                    <Briefcase size={14} className="inline mr-1" />
                    현재 학기 직책 ({perms.sources.positions[0]?.semester_name})
                  </h4>
                  <div className="space-y-1.5">
                    {perms.sources.positions.map((p) => (
                      <div key={p.template_id} className="text-caption">
                        <span className="font-medium text-text-primary">{p.display_name}</span>
                        <span className="text-text-tertiary ml-1">({p.key})</span>
                        <span className="text-text-tertiary"> · 권한 {p.permissions.length}개</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 권한 키 + 출처 */}
              <div className="bg-bg-primary border border-border-default rounded">
                <div className="flex items-center justify-between p-3 border-b border-border-default">
                  <h4 className="text-body font-medium text-text-primary">권한 키 + 출처</h4>
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="권한 키 검색..."
                      className="pl-7 pr-2 py-1 text-caption border border-border-default rounded bg-bg-primary w-48"
                    />
                  </div>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  {filteredKeys.length === 0 ? (
                    <div className="px-3 py-6 text-caption text-text-tertiary text-center">
                      {search ? "검색 결과 없음" : "권한 없음"}
                    </div>
                  ) : (
                    filteredKeys.map((k) => (
                      <div key={k} className="px-3 py-2 border-t border-border-default first:border-t-0">
                        <div className="text-body text-text-primary font-mono text-sm">{k}</div>
                        <div className="mt-1">
                          {(perms.permission_sources[k] || []).map((src, i) => (
                            <SourceChip key={i} src={src} />
                          ))}
                          {(perms.permission_sources[k] || []).length === 0 && (
                            <span className="text-caption text-text-tertiary">출처 미확인</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PositionTemplateForm({
  template, allPerms, onClose, onSaved,
}: {
  template: PositionTemplate;
  allPerms: Record<string, PermissionItem[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = template.id === 0;
  const [key, setKey] = useState(template.key);
  const [displayName, setDisplayName] = useState(template.display_name);
  const [description, setDescription] = useState(template.description || "");
  const [category, setCategory] = useState(template.category || "기타");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(template.permission_keys),
  );
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const toggle = (k: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const save = async () => {
    if (!displayName.trim()) {
      alert("직책 이름을 입력하세요");
      return;
    }
    if (isNew && !key.trim()) {
      alert("키를 입력하세요 (영문/숫자/_/-/.)");
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        display_name: displayName.trim(),
        description: description.trim() || null,
        category: category.trim() || "기타",
        permission_keys: Array.from(selectedKeys),
      };
      if (isNew) {
        body.key = key.trim();
        await api.post("/api/permissions/position-templates", body);
      } else {
        await api.put(`/api/permissions/position-templates/${template.id}`, body);
      }
      onSaved();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  // 검색 필터
  const filtered: Record<string, PermissionItem[]> = {};
  for (const [cat, perms] of Object.entries(allPerms)) {
    const matched = perms.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.key.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      );
    });
    if (matched.length > 0) filtered[cat] = matched;
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={isNew ? "직책 템플릿 생성" : `직책 수정: ${template.display_name}`}
      maxWidth="2xl"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              키 {isNew && "*"} {!isNew && "(변경 불가)"}
            </label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!isNew}
              placeholder="예: homeroom_1grade"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary disabled:bg-bg-secondary disabled:text-text-tertiary"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">분류</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="예: 학급, 부장, 동아리"
              className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            />
          </div>
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">직책 이름 *</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="예: 1학년 담임"
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          />
        </div>
        <div>
          <label className="block text-caption text-text-secondary mb-1">설명 (선택)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 직책이 어떤 업무를 담당하는지"
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-caption text-text-secondary">
              부여할 권한 ({selectedKeys.size}개 선택됨)
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색..."
              className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary w-48"
            />
          </div>
          <div className="border border-border-default rounded max-h-96 overflow-y-auto">
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
                        onChange={() => !p.super_admin_only && toggle(p.key)}
                        disabled={p.super_admin_only}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-body text-text-primary">{p.display_name}</div>
                        <div className="text-caption text-text-tertiary truncate">{p.key}</div>
                      </div>
                      {p.super_admin_only && (
                        <span className="text-caption text-status-error" title="최고관리자 전용 — 직책 권한에 포함 불가">SA</span>
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
      </div>

      <ModalFooter>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          <X size={14} /> 취소
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Check size={14} />
          {saving ? "저장 중..." : "저장"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
