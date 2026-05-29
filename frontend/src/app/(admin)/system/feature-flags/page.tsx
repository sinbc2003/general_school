"use client";

/**
 * Feature Flag 관리 페이지 — `/system/feature-flags`.
 * super_admin (또는 system.feature_flags.manage 권한) 전용.
 *
 * 학교가 기능별로 ON/OFF 결정 → 사이드바·라우터가 동적으로 반영.
 * 모든 코드는 한 main에, 학교마다 다른 활성 기능 → 충돌 X, 업그레이드 충돌 X.
 */

import { useEffect, useState, useCallback } from "react";
import { Flag, Loader2, CheckCircle2, EyeOff, Shield } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

interface FeatureItem {
  key: string;
  label: string;
  category: string;
  description: string;
  default_status: "off" | "admin_only" | "on";
  status: "off" | "admin_only" | "on";
  updated_at: string | null;
}

const STATUS_META = {
  off: { label: "비활성", icon: EyeOff, color: "text-gray-500", bg: "bg-gray-100" },
  admin_only: { label: "관리자만", icon: Shield, color: "text-amber-700", bg: "bg-amber-100" },
  on: { label: "활성", icon: CheckCircle2, color: "text-emerald-700", bg: "bg-emerald-100" },
} as const;

export default function FeatureFlagsPage() {
  const { refreshUser } = useAuth();
  const [items, setItems] = useState<FeatureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ items: FeatureItem[] }>("/api/system/feature-flags");
      setItems(r.items);
    } catch (e: any) {
      setError(e?.detail || "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (key: string, status: FeatureItem["status"]) => {
    setSavingKey(key);
    try {
      await api.put(`/api/system/feature-flags/${key}`, { status });
      setItems((prev) =>
        prev.map((it) => it.key === key ? { ...it, status } : it)
      );
      // AuthContext의 features dict도 갱신 (사이드바 즉시 반영)
      await refreshUser();
    } catch (e: any) {
      alert(e?.detail || "변경 실패");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12 text-text-tertiary">
          <Loader2 size={20} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      </div>
    );
  }

  // 카테고리별 그룹화
  const groups: Record<string, FeatureItem[]> = {};
  for (const it of items) {
    if (!groups[it.category]) groups[it.category] = [];
    groups[it.category].push(it);
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <Flag size={22} className="text-text-primary" />
        <h1 className="text-title">Feature Flags</h1>
      </div>
      <p className="text-caption text-text-secondary mb-5">
        각 기능을 학교에 맞게 ON/OFF 하세요. 사이드바·메뉴·API가 즉시 반영됩니다.
        모든 학교가 같은 코드 베이스를 쓰지만, 활성 기능만 학교마다 다르게 표시됩니다.
      </p>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-caption text-red-700">
          {error}
        </div>
      )}

      {Object.entries(groups).map(([category, list]) => (
        <div key={category} className="mb-6">
          <h2 className="text-body font-semibold mb-3 pb-2 border-b border-border-default">
            {category}
          </h2>
          <div className="space-y-2">
            {list.map((it) => {
              const meta = STATUS_META[it.status];
              const Icon = meta.icon;
              const saving = savingKey === it.key;
              return (
                <div
                  key={it.key}
                  className="border border-border-default rounded-lg p-3 bg-bg-primary flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-body font-medium">{it.label}</span>
                      <code className="text-[11px] text-text-tertiary font-mono">{it.key}</code>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded ${meta.bg} ${meta.color}`}>
                        <Icon size={10} />
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-caption text-text-secondary">{it.description}</p>
                  </div>
                  <select
                    value={it.status}
                    onChange={(e) => updateStatus(it.key, e.target.value as FeatureItem["status"])}
                    disabled={saving}
                    className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary disabled:opacity-50"
                  >
                    <option value="off">비활성 (OFF)</option>
                    <option value="admin_only">관리자만</option>
                    <option value="on">활성 (ON)</option>
                  </select>
                  {saving && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
