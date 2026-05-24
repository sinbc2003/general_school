"use client";

/**
 * 코스웨어 공통 위젯 — CircularProgress, StatBox, AccuracyBadge.
 *
 * 외부 차트 라이브러리 없이 SVG inline. 페이지 chunk 가벼움.
 */

import type { LucideIcon } from "lucide-react";


// ── CircularProgress (SVG 도넛) ──────────────────────────────────────────────

interface CircularProgressProps {
  value: number;        // 0~1
  size?: number;        // px
  strokeWidth?: number;
  showLabel?: boolean;
  label?: string;       // 중앙 텍스트 override (없으면 %)
  tone?: "auto" | "emerald" | "amber" | "red" | "gray";
}

export function CircularProgress({
  value, size = 60, strokeWidth = 6, showLabel = true, label, tone = "auto",
}: CircularProgressProps) {
  const v = Math.max(0, Math.min(1, value));
  const pct = Math.round(v * 100);

  const actualTone =
    tone === "auto"
      ? v >= 0.8 ? "emerald" : v >= 0.5 ? "amber" : v > 0 ? "red" : "gray"
      : tone;
  const colorClass = {
    emerald: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
    gray: "text-gray-300",
  }[actualTone];

  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - v);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="currentColor" strokeWidth={strokeWidth}
          fill="none" className="text-bg-secondary"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="currentColor" strokeWidth={strokeWidth}
          fill="none" strokeLinecap="round"
          className={`transition-all duration-500 ${colorClass}`}
          strokeDasharray={c} strokeDashoffset={dashOffset}
        />
      </svg>
      {showLabel && (
        <div
          className="absolute inset-0 flex items-center justify-center text-text-primary font-semibold"
          style={{ fontSize: size <= 50 ? 11 : size <= 80 ? 13 : 16 }}
        >
          {label ?? `${pct}%`}
        </div>
      )}
    </div>
  );
}


// ── StatBox ──────────────────────────────────────────────────────────────────

interface StatBoxProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subText?: string;
  tone?: "default" | "emerald" | "amber" | "red" | "sky" | "cream";
}

export function StatBox({ icon: Icon, label, value, subText, tone = "default" }: StatBoxProps) {
  const toneStyle = {
    default: "bg-bg-primary border-border-default",
    emerald: "bg-emerald-50 border-emerald-200",
    amber: "bg-amber-50 border-amber-200",
    red: "bg-red-50 border-red-200",
    sky: "bg-sky-50 border-sky-200",
    cream: "bg-cream-50 border-cream-300",
  }[tone];
  const iconStyle = {
    default: "text-text-tertiary",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
    sky: "text-sky-600",
    cream: "text-text-secondary",
  }[tone];

  return (
    <div className={`rounded-lg border p-4 ${toneStyle}`}>
      <div className="flex items-center gap-2 text-caption text-text-tertiary mb-1">
        <Icon size={14} className={iconStyle} />
        <span>{label}</span>
      </div>
      <div className="text-h2 font-semibold text-text-primary leading-tight">
        {value}
      </div>
      {subText && (
        <div className="text-[11px] text-text-tertiary mt-0.5">{subText}</div>
      )}
    </div>
  );
}


// ── AccuracyBadge (작은 라벨용) ─────────────────────────────────────────────

interface AccuracyBadgeProps {
  value: number;  // 0~1
  size?: "sm" | "md";
}

export function AccuracyBadge({ value, size = "sm" }: AccuracyBadgeProps) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.8 ? "bg-emerald-100 text-emerald-700"
    : value >= 0.5 ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${tone} ${
      size === "md" ? "text-[11px] px-2" : ""
    }`}>
      {pct}%
    </span>
  );
}
