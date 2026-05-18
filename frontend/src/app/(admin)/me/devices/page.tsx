"use client";

/**
 * 내 신뢰 장치 관리.
 *
 * 이메일 2FA 등록 시 '이 장치 30일 기억' 옵션으로 등록된 장치 목록.
 * 사용자가 임의로 취소 가능 (다음 로그인 시 이메일 코드 다시 필요).
 *
 * 보안 사고 의심 시 '모든 장치 취소' 버튼으로 즉시 차단.
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Smartphone, Trash2, Shield, AlertCircle, RefreshCw } from "lucide-react";

interface Device {
  id: number;
  label: string | null;
  ip_address: string | null;
  last_used_at: string | null;
  expires_at: string;
  created_at: string;
  current: boolean;
}

function parseUA(ua: string | null): string {
  if (!ua) return "알 수 없는 장치";
  // 간단한 UA 파싱
  const ualow = ua.toLowerCase();
  let browser = "Browser";
  if (ualow.includes("edg")) browser = "Edge";
  else if (ualow.includes("chrome")) browser = "Chrome";
  else if (ualow.includes("firefox")) browser = "Firefox";
  else if (ualow.includes("safari")) browser = "Safari";
  let os = "OS";
  if (ualow.includes("windows")) os = "Windows";
  else if (ualow.includes("mac")) os = "macOS";
  else if (ualow.includes("linux")) os = "Linux";
  else if (ualow.includes("android")) os = "Android";
  else if (ualow.includes("iphone") || ualow.includes("ipad")) os = "iOS";
  return `${browser} · ${os}`;
}

export default function MyDevicesPage() {
  const [items, setItems] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<{ items: Device[] }>("/api/auth/trusted-devices");
      setItems(data.items);
    } catch (err: any) {
      setError(err?.detail || "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const revoke = async (d: Device) => {
    const label = d.label || "이 장치";
    if (d.current) {
      if (!confirm(`'${label}'은(는) 현재 사용 중인 장치입니다.\n취소하면 다음 로그인 시 이메일 코드를 다시 받아야 합니다. 계속하시겠습니까?`)) return;
    } else {
      if (!confirm(`'${label}' 장치의 신뢰를 취소하시겠습니까?`)) return;
    }
    try {
      await api.delete(`/api/auth/trusted-devices/${d.id}`);
      fetchAll();
    } catch (err: any) {
      alert(err?.detail || "취소 실패");
    }
  };

  const revokeAll = async () => {
    if (!confirm(
      "모든 신뢰 장치를 취소합니다.\n" +
      "모든 장치(현재 사용 중인 장치 포함)에서 이메일 인증을 다시 받아야 합니다.\n" +
      "보안 사고 의심 시에만 사용하세요. 계속하시겠습니까?",
    )) return;
    try {
      const res = await api.delete<{ revoked: number }>("/api/auth/trusted-devices");
      fetchAll();
      alert(`${res.revoked}개 장치 취소 완료`);
    } catch (err: any) {
      alert(err?.detail || "일괄 취소 실패");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <Shield size={22} /> 내 신뢰 장치
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            '이 장치 기억' 옵션으로 등록된 장치 목록입니다. 의심스러운 장치는 즉시 취소하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
          {items.length > 0 && (
            <button
              onClick={revokeAll}
              className="flex items-center gap-1 px-3 py-1.5 text-caption bg-status-error text-white rounded hover:opacity-90"
            >
              <Trash2 size={14} />
              모든 장치 취소
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-caption text-status-error flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="py-12 text-center text-text-tertiary">로딩 중...</div>
      )}

      {!loading && items.length === 0 && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-12 text-center text-text-tertiary">
          <Smartphone size={32} className="mx-auto mb-2 opacity-40" />
          신뢰 장치 없음 — 로그인 시 매번 이메일 코드 인증이 필요합니다.
        </div>
      )}

      <div className="space-y-3">
        {items.map((d) => (
          <div
            key={d.id}
            className={`bg-bg-primary border rounded-lg p-4 flex items-start gap-3 ${
              d.current ? "border-accent" : "border-border-default"
            }`}
          >
            <Smartphone size={20} className="text-text-tertiary flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-body font-medium text-text-primary">
                  {d.label || parseUA(d.label)}
                </span>
                {d.current && (
                  <span className="text-caption px-2 py-0.5 bg-accent text-white rounded">
                    현재 장치
                  </span>
                )}
              </div>
              <div className="text-caption text-text-tertiary mt-1 space-y-0.5">
                {d.ip_address && <div>IP: {d.ip_address}</div>}
                <div>
                  등록: {d.created_at?.slice(0, 16).replace("T", " ")}
                  {" · "}
                  만료: {d.expires_at?.slice(0, 10)}
                </div>
                {d.last_used_at && (
                  <div>마지막 사용: {d.last_used_at.slice(0, 16).replace("T", " ")}</div>
                )}
              </div>
            </div>
            <button
              onClick={() => revoke(d)}
              title="이 장치 취소"
              className="p-2 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 p-3 bg-cream-100 border border-cream-300 rounded text-caption text-text-secondary">
        <b>안내</b>
        <ul className="list-disc list-inside mt-1 space-y-0.5">
          <li>본인의 개인 PC/노트북에서만 '이 장치 기억'을 활성화하세요.</li>
          <li>공용 컴퓨터(학교 컴퓨터실, 직원실 공용 PC 등)에서는 절대 활성화하지 마세요.</li>
          <li>장치 분실·도난 시 즉시 모든 장치를 취소하고 비밀번호를 변경하세요.</li>
          <li>신뢰 장치는 30일 후 자동 만료되며, 만료 후엔 이메일 코드 인증이 다시 필요합니다.</li>
        </ul>
      </div>
    </div>
  );
}
