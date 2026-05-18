"use client";

/**
 * 역할별 권한 매트릭스 탭 — 권한 키 × 역할 토글 그리드.
 *
 * 정책 토글 포함:
 * - 지정관리자 모드 (full / scoped)
 * - admin 2FA 강제
 *
 * 검색 + 카테고리 접기로 100+ 권한 키 환경 대응.
 */

import { useCallback, useEffect, useState } from "react";
import { Save, Search, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";


interface MatrixRow {
  id: number;
  key: string;
  display_name: string;
  category: string;
  requires_2fa: boolean;
  super_admin_only: boolean;
  [role: string]: any;
}


export function PermissionMatrixTab() {
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
  // 검색/필터
  const [matrixSearch, setMatrixSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/permissions/matrix");
      setMatrix(data.matrix);
      setRoles(data.roles);
      if (data.designated_admin_mode) {
        setDesignatedMode(data.designated_admin_mode);
      }
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
    if (role === "designated_admin") {
      if (!isSuperAdmin || designatedMode !== "scoped") return;
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

  // 검색 필터 + 카테고리별 그룹핑
  const q = matrixSearch.trim().toLowerCase();
  const filteredMatrix = q
    ? matrix.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          r.display_name.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q),
      )
    : matrix;
  const categories = new Map<string, MatrixRow[]>();
  for (const row of filteredMatrix) {
    const cat = row.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(row);
  }
  const totalFiltered = filteredMatrix.length;

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;

  return (
    <div>
      {/* 정책 카드 (super_admin 전용) */}
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

      {/* 검색 + 일괄 접기 */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={matrixSearch}
            onChange={(e) => setMatrixSearch(e.target.value)}
            placeholder="권한 키·표시명·카테고리 검색..."
            className="w-full pl-8 pr-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-2 text-caption text-text-tertiary">
          <span>전체 {matrix.length}개</span>
          {matrixSearch && <span>· 매칭 {totalFiltered}개</span>}
          <button
            onClick={() => setCollapsedCats(new Set(Array.from(categories.keys())))}
            className="text-caption text-text-tertiary hover:text-accent"
          >
            전체 접기
          </button>
          <button
            onClick={() => setCollapsedCats(new Set())}
            className="text-caption text-text-tertiary hover:text-accent"
          >
            전체 펼치기
          </button>
        </div>
      </div>

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
                  <td colSpan={roles.length + 1} className="px-4 py-2">
                    <button
                      onClick={() => toggleCat(cat)}
                      className="flex items-center gap-1.5 text-caption font-semibold text-text-secondary hover:text-text-primary w-full text-left"
                    >
                      <span className="inline-block w-3 text-text-tertiary">
                        {collapsedCats.has(cat) ? "▶" : "▼"}
                      </span>
                      {cat}
                      <span className="ml-2 text-text-tertiary font-normal">({rows.length})</span>
                    </button>
                  </td>
                </tr>
                {!collapsedCats.has(cat) && rows.map((row) => {
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
                        let isAutoChecked = false;
                        let isTogglable = false;
                        if (isSuperRow) {
                          isAutoChecked = true;
                        } else if (role === "designated_admin") {
                          if (designatedMode === "full") {
                            isAutoChecked = !row.super_admin_only;
                          } else {
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
