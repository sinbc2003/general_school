"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { Shield, Users, Layers, Save, Lock, Briefcase, Plus, Edit3, Trash2, Check, X, Building2 } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { PositionApplyToDepartmentModal } from "@/components/admin/PositionApplyToDepartmentModal";

type Tab = "matrix" | "admins" | "groups" | "positions";

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
        <TabButton active={tab === "positions"} onClick={() => setTab("positions")} icon={Briefcase} label="직책 권한 (학기)" />
        <TabButton active={tab === "admins"} onClick={() => setTab("admins")} icon={Users} label="지정관리자" />
        <TabButton active={tab === "groups"} onClick={() => setTab("groups")} icon={Layers} label="권한 그룹" />
      </div>

      {tab === "matrix" && <PermissionMatrix />}
      {tab === "positions" && <PositionTemplates />}
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
  // 지정관리자 모드 (full/scoped) — full이면 designated_admin 컬럼 토글 비활성
  const [designatedMode, setDesignatedMode] = useState<"full" | "scoped">("full");
  const [modeChanging, setModeChanging] = useState(false);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/permissions/matrix");
      setMatrix(data.matrix);
      setRoles(data.roles);
      if (data.designated_admin_mode) {
        setDesignatedMode(data.designated_admin_mode);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

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
      {/* 지정관리자 모드 선택 (super_admin 전용) */}
      {isSuperAdmin && (
        <div className="mb-4 p-3 bg-cream-100 border border-cream-300 rounded-lg">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-caption text-text-secondary flex-1 min-w-[280px]">
              <b>지정관리자 권한 모드</b> · 변경 시 모든 지정관리자 세션 자동 종료
              <div className="text-text-tertiary mt-0.5">
                {designatedMode === "full"
                  ? "현재: 모든 권한 자동 (최고관리자 전용 제외)"
                  : "현재: 매트릭스에서 명시 부여한 권한만"}
              </div>
            </div>
            <div className="flex gap-1 bg-bg-primary rounded p-0.5">
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
