"use client";

/**
 * Quota 사용량 게이지 + 만료 임박 배너.
 *
 * - info 객체 통째 단일 prop (drilling 회피)
 * - 색 분기: 무제한 emerald / 90%+ 빨강 / 80%+ 노랑 / 그 외 파랑
 * - 만료 임박 (7일 이내) 배너 자동 표시
 */

import { AlertTriangle } from "lucide-react";
import { formatMB, type DriveInfo } from "./_drive-shared";

interface DriveQuotaGaugeProps {
  info: DriveInfo | null;
}

export function DriveQuotaGauge({ info }: DriveQuotaGaugeProps) {
  if (!info) return null;

  const gaugeColor = info.unlimited
    ? "#10b981"
    : info.usage_ratio >= 0.9
    ? "#dc2626"
    : info.usage_ratio >= 0.8
    ? "#f59e0b"
    : "#3b82f6";

  return (
    <>
      {/* 만료 임박 배너 */}
      {info.days_until_expire != null && info.days_until_expire <= 7 && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded bg-amber-50 border border-amber-200">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5" />
          <div className="text-[13px] text-amber-900">
            계정이 <strong>{info.days_until_expire}일 후</strong> 만료됩니다. 보관하실 자료는 미리 백업하세요.
          </div>
        </div>
      )}

      {/* Quota 게이지 */}
      <div className="mb-6 bg-bg-primary border border-border-default rounded-lg px-5 py-4">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[13px] text-text-secondary">사용량</div>
          <div className="text-[13px] text-text-secondary">
            {info.unlimited ? (
              <span className="text-emerald-600 font-semibold">무제한</span>
            ) : (
              <>
                <span className="font-semibold text-text-primary">
                  {formatMB(info.used_bytes)}
                </span>{" "}
                / {formatMB(info.quota_bytes)}{" "}
                <span className="text-text-tertiary">({Math.round(info.usage_ratio * 100)}%)</span>
              </>
            )}
          </div>
        </div>
        <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full transition-all"
            style={{
              width: info.unlimited ? "100%" : `${Math.min(100, info.usage_ratio * 100)}%`,
              backgroundColor: gaugeColor,
            }}
          />
        </div>
        {!info.unlimited && info.usage_ratio >= 0.8 && (
          <div className="text-[12px] text-amber-700 mt-2">
            용량이 부족하면 휴지통을 비우거나 관리자에게 증설을 요청하세요.
          </div>
        )}
      </div>
    </>
  );
}
