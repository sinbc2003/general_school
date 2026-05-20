"use client";

/**
 * 부서장 권한 위임 페이지 (`/system/departments/{id}/delegations`).
 *
 * 흐름:
 *   - 부장 또는 admin만 접근
 *   - 좌측: 부서 멤버 list
 *   - 멤버 선택 시 우측에 현재 위임된 권한 + 추가 가능한 권한
 *   - 권한 추가/회수 즉시 적용
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Users, Shield, X, Plus, ArrowLeft, Building2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface Member {
  id: number;
  name: string;
  email: string;
  role: string;
  is_lead: boolean;
}

interface AvailablePerm {
  key: string;
  display_name: string;
  category: string;
}

interface DelegationItem {
  user_id: number;
  user_name: string;
  permission_key: string;
  permission_display: string;
  granted_at: string | null;
}

export default function DepartmentDelegationPage() {
  const params = useParams();
  const router = useRouter();
  const deptId = Number(params.id);
  const [department, setDepartment] = useState<{ id: number; name: string; lead_user_id: number | null } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [available, setAvailable] = useState<AvailablePerm[]>([]);
  const [delegations, setDelegations] = useState<DelegationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, p, d] = await Promise.all([
        api.get<{ department: any; items: Member[] }>(`/api/departments/${deptId}/members`),
        api.get<{ items: AvailablePerm[] }>(`/api/departments/${deptId}/available-permissions`),
        api.get<{ items: DelegationItem[] }>(`/api/departments/${deptId}/delegations`),
      ]);
      setDepartment(m.department);
      setMembers(m.items);
      setAvailable(p.items);
      setDelegations(d.items);
      if (m.items.length > 0 && selected === null) setSelected(m.items[0].id);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    } finally { setLoading(false); }
  }, [deptId, selected]);

  useEffect(() => { load(); }, [deptId]);  // eslint-disable-line

  const grant = async (key: string) => {
    if (!selected) return;
    try {
      await api.post(`/api/departments/${deptId}/delegations`, {
        user_id: selected, permission_key: key,
      });
      await load();
    } catch (e: any) {
      alert(e?.message || "위임 실패");
    }
  };

  const revoke = async (uid: number, key: string) => {
    if (!confirm(`"${key}" 권한을 회수합니다`)) return;
    try {
      await api.delete(`/api/departments/${deptId}/delegations/${uid}/${encodeURIComponent(key)}`);
      await load();
    } catch (e: any) {
      alert(e?.message || "회수 실패");
    }
  };

  const memberDelegations = selected
    ? delegations.filter((d) => d.user_id === selected)
    : [];
  const memberDelegationKeys = new Set(memberDelegations.map((d) => d.permission_key));

  const groupedByCategory: Record<string, AvailablePerm[]> = {};
  for (const p of available) {
    if (!groupedByCategory[p.category]) groupedByCategory[p.category] = [];
    groupedByCategory[p.category].push(p);
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/system/departments")}
          className="p-1.5 rounded hover:bg-bg-secondary text-text-tertiary"
        >
          <ArrowLeft size={16} />
        </button>
        <Building2 size={18} className="text-text-secondary" />
        <h1 className="text-title text-text-primary">
          {department?.name || "부서"} — 권한 위임
        </h1>
      </div>
      <p className="text-caption text-text-tertiary mb-5">
        부장이 부서 소속 사용자에게 업무 권한을 위임합니다. 부장이 보유한 권한 중 위임 가능한 것만 노출됩니다.
      </p>

      {error && <div className="mb-4 text-red-600">{error}</div>}

      {loading ? (
        <div className="text-text-tertiary">불러오는 중...</div>
      ) : members.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <Users size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">부서 소속 사용자가 없습니다</div>
          <div className="text-caption text-text-tertiary mt-1">
            /system/users에서 사용자의 "소속 부서"를 이 부서로 설정하세요
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 좌: 멤버 목록 */}
          <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-border-default text-[12px] font-semibold text-text-secondary bg-bg-secondary">
              부서 멤버 ({members.length})
            </div>
            <div className="divide-y divide-border-default max-h-[600px] overflow-y-auto">
              {members.map((m) => {
                const isActive = m.id === selected;
                const delegationCount = delegations.filter((d) => d.user_id === m.id).length;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelected(m.id)}
                    className={`w-full px-4 py-2.5 text-left transition flex items-center justify-between ${
                      isActive ? "bg-accent/10 border-l-2 border-accent" : "hover:bg-bg-secondary"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-medium text-text-primary truncate">
                        {m.name}
                        {m.is_lead && (
                          <span className="ml-1 text-[10px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded">부장</span>
                        )}
                      </div>
                      <div className="text-[11px] text-text-tertiary truncate">{m.email}</div>
                    </div>
                    {delegationCount > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded ml-2">
                        +{delegationCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 우: 권한 카탈로그 */}
          <div className="lg:col-span-2 bg-bg-primary border border-border-default rounded-lg overflow-hidden">
            {selected ? (
              <>
                <div className="px-4 py-3 border-b border-border-default flex items-center justify-between bg-bg-secondary">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-text-secondary" />
                    <div className="text-body font-semibold text-text-primary">
                      {members.find((m) => m.id === selected)?.name}의 권한
                    </div>
                  </div>
                  <span className="text-[11px] text-text-tertiary">
                    부여 {memberDelegations.length} / 가능 {available.length}
                  </span>
                </div>
                <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                  {/* 현재 위임된 권한 */}
                  {memberDelegations.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-text-tertiary uppercase mb-2">
                        부여된 권한
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {memberDelegations.map((d) => (
                          <span
                            key={d.permission_key}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12px] rounded"
                          >
                            {d.permission_display}
                            <button
                              type="button"
                              onClick={() => revoke(d.user_id, d.permission_key)}
                              className="text-emerald-600 hover:text-red-600"
                              title="회수"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 카테고리별 권한 */}
                  {Object.entries(groupedByCategory).map(([category, perms]) => (
                    <div key={category}>
                      <div className="text-[11px] font-semibold text-text-tertiary uppercase mb-2">
                        {category}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {perms.map((p) => {
                          const granted = memberDelegationKeys.has(p.key);
                          return (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => !granted && grant(p.key)}
                              disabled={granted}
                              className={`text-left px-2.5 py-1.5 rounded text-[12px] border ${
                                granted
                                  ? "bg-bg-secondary border-border-default text-text-tertiary cursor-not-allowed"
                                  : "bg-bg-primary border-border-default hover:bg-accent/5 hover:border-accent/40 text-text-primary"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                {granted ? (
                                  <span className="text-emerald-600">✓</span>
                                ) : (
                                  <Plus size={11} className="text-accent" />
                                )}
                                <span className="truncate">{p.display_name}</span>
                              </div>
                              <code className="text-[10px] text-text-tertiary block truncate">{p.key}</code>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {available.length === 0 && (
                    <div className="text-center text-[12px] text-text-tertiary py-6">
                      위임 가능한 권한이 없습니다 (본인이 보유한 권한 중 위임 가능한 것만 노출).
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-text-tertiary">왼쪽에서 멤버를 선택하세요</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
