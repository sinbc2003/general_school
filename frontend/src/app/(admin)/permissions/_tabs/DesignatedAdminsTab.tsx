"use client";

/**
 * 지정관리자 관리 탭 — 지정관리자 목록 + 유효 권한 요약.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

export function DesignatedAdminsTab() {
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
