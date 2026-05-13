"use client";

import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { Users, Shield, FileText, Activity } from "lucide-react";

export default function DashboardPage() {
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (isAdmin) {
      api.get("/api/users?per_page=1").then((data) => {
        setStats({ totalUsers: data.total });
      }).catch(() => {});
    }
  }, [isAdmin]);

  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">대시보드</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isAdmin && (
          <>
            <StatCard
              icon={Users}
              label="전체 사용자"
              value={stats?.totalUsers ?? "-"}
              color="text-accent"
            />
            <StatCard
              icon={Shield}
              label="내 역할"
              value={user?.role === "super_admin" ? "최고관리자" : "지정관리자"}
              color="text-status-success"
            />
            <StatCard
              icon={FileText}
              label="플랫폼"
              value="v1.0.0"
              color="text-status-warning"
            />
            <StatCard
              icon={Activity}
              label="상태"
              value="정상"
              color="text-status-success"
            />
          </>
        )}

        {!isAdmin && (
          <StatCard
            icon={Users}
            label="환영합니다"
            value={user?.name || ""}
            color="text-accent"
          />
        )}
      </div>

      <div className="bg-bg-primary rounded-lg border border-border-default p-6">
        <h2 className="text-body font-semibold text-text-primary mb-3">
          안내
        </h2>
        <p className="text-body text-text-secondary">
          {isSuperAdmin
            ? "최고관리자로 로그인하셨습니다. 사용자 관리, 권한 관리, 시스템 설정을 수행할 수 있습니다."
            : isAdmin
            ? "관리자 권한으로 로그인하셨습니다. 부여된 권한 범위 내에서 관리 기능을 사용할 수 있습니다."
            : "교사 페이지입니다. 좌측 메뉴에서 필요한 기능을 선택하세요."}
        </p>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-bg-primary rounded-lg border border-border-default p-4">
      <div className="flex items-center gap-3">
        <div className={`${color}`}>
          <Icon size={24} />
        </div>
        <div>
          <div className="text-caption text-text-tertiary">{label}</div>
          <div className="text-body font-semibold text-text-primary">{value}</div>
        </div>
      </div>
    </div>
  );
}
