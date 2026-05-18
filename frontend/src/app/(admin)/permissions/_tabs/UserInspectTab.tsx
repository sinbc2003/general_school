"use client";

/**
 * 사용자 권한 검사 탭 — 권한 출처 추적 + 활성 세션 + 강제 로그아웃.
 *
 * 분리 이유: /permissions/page.tsx가 1935줄로 비대. 각 탭을 별도 파일로 분리.
 */

import { useCallback, useEffect, useState } from "react";
import { Briefcase, Search, LogOut } from "lucide-react";
import { api } from "@/lib/api/client";
import { UserSearchInput } from "@/components/admin/UserSearchInput";

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

export function UserInspectTab() {
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

  // 검색 필터
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

              {/* 직책 상세 */}
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
