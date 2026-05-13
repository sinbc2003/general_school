"use client";

import { useState } from "react";
import { TrendingUp, School, BarChart3, Target } from "lucide-react";

// Mock data for analysis dashboard
const UNIVERSITY_STATS = [
  { name: "서울대학교", applied: 15, accepted: 8, rate: 53.3 },
  { name: "KAIST", applied: 12, accepted: 7, rate: 58.3 },
  { name: "포항공대", applied: 10, accepted: 6, rate: 60.0 },
  { name: "연세대학교", applied: 18, accepted: 12, rate: 66.7 },
  { name: "고려대학교", applied: 16, accepted: 11, rate: 68.8 },
  { name: "성균관대학교", applied: 8, accepted: 6, rate: 75.0 },
  { name: "한양대학교", applied: 7, accepted: 5, rate: 71.4 },
  { name: "GIST", applied: 5, accepted: 4, rate: 80.0 },
];

const YEARLY_TRENDS = [
  { year: 2022, total: 120, accepted: 78, rate: 65.0 },
  { year: 2023, total: 115, accepted: 82, rate: 71.3 },
  { year: 2024, total: 125, accepted: 90, rate: 72.0 },
  { year: 2025, total: 118, accepted: 88, rate: 74.6 },
  { year: 2026, total: 122, accepted: 92, rate: 75.4 },
];

const ADMISSION_TYPE_STATS = [
  { type: "학생부종합", count: 45, rate: 72.0 },
  { type: "학생부교과", count: 20, rate: 80.0 },
  { type: "논술", count: 15, rate: 60.0 },
  { type: "수능정시", count: 12, rate: 75.0 },
];

export default function AdmissionsAnalysisPage() {
  const currentYear = YEARLY_TRENDS[YEARLY_TRENDS.length - 1];
  const prevYear = YEARLY_TRENDS[YEARLY_TRENDS.length - 2];
  const rateDiff = (currentYear.rate - prevYear.rate).toFixed(1);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">합격자 분석</h1>
        <span className="text-caption text-text-tertiary">* 샘플 데이터 기반</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon={Target}
          label="총 지원"
          value={`${currentYear.total}건`}
          sub={`${currentYear.year}년`}
          color="text-blue-600"
        />
        <SummaryCard
          icon={School}
          label="합격"
          value={`${currentYear.accepted}건`}
          sub={`합격률 ${currentYear.rate}%`}
          color="text-green-600"
        />
        <SummaryCard
          icon={TrendingUp}
          label="전년 대비"
          value={`${Number(rateDiff) >= 0 ? "+" : ""}${rateDiff}%p`}
          sub={`${prevYear.rate}% → ${currentYear.rate}%`}
          color={Number(rateDiff) >= 0 ? "text-status-success" : "text-status-error"}
        />
        <SummaryCard
          icon={BarChart3}
          label="주요 대학 합격"
          value={`${UNIVERSITY_STATS.slice(0, 3).reduce((s, u) => s + u.accepted, 0)}명`}
          sub="서울대/KAIST/포항공대"
          color="text-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* University acceptance rates */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <h2 className="text-body font-semibold text-text-primary mb-4">대학별 합격률</h2>
          <div className="space-y-3">
            {UNIVERSITY_STATS.map((uni) => (
              <div key={uni.name} className="flex items-center gap-3">
                <span className="text-body text-text-primary w-28 flex-shrink-0 truncate">{uni.name}</span>
                <div className="flex-1 h-6 bg-bg-secondary rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${uni.rate}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-caption font-medium text-text-primary">
                    {uni.accepted}/{uni.applied}
                  </span>
                </div>
                <span className="text-caption text-text-secondary w-14 text-right">{uni.rate}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Yearly trends */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <h2 className="text-body font-semibold text-text-primary mb-4">연도별 추이</h2>
          <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-bg-secondary">
                  <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">년도</th>
                  <th className="px-4 py-2 text-right text-caption text-text-tertiary font-medium">지원</th>
                  <th className="px-4 py-2 text-right text-caption text-text-tertiary font-medium">합격</th>
                  <th className="px-4 py-2 text-right text-caption text-text-tertiary font-medium">합격률</th>
                </tr>
              </thead>
              <tbody>
                {YEARLY_TRENDS.map((y) => (
                  <tr key={y.year} className="border-t border-border-default hover:bg-bg-secondary">
                    <td className="px-4 py-2 text-body text-text-primary">{y.year}</td>
                    <td className="px-4 py-2 text-body text-text-secondary text-right">{y.total}건</td>
                    <td className="px-4 py-2 text-body text-text-primary text-right">{y.accepted}건</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`text-body font-medium ${y.rate >= 70 ? "text-status-success" : "text-status-warning"}`}>
                        {y.rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Simple bar visualization */}
          <div className="mt-4">
            <h3 className="text-caption text-text-tertiary mb-2">합격률 추이</h3>
            <div className="flex items-end gap-2 h-24">
              {YEARLY_TRENDS.map((y) => (
                <div key={y.year} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-caption text-text-secondary">{y.rate}%</span>
                  <div
                    className="w-full bg-accent rounded-t transition-all"
                    style={{ height: `${(y.rate / 100) * 80}px` }}
                  />
                  <span className="text-caption text-text-tertiary">{y.year}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Admission type breakdown */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4 lg:col-span-2">
          <h2 className="text-body font-semibold text-text-primary mb-4">전형별 현황</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {ADMISSION_TYPE_STATS.map((at) => (
              <div key={at.type} className="bg-bg-secondary rounded-lg p-4 text-center">
                <div className="text-caption text-text-tertiary mb-1">{at.type}</div>
                <div className="text-title text-text-primary">{at.count}명</div>
                <div className={`text-body font-medium mt-1 ${at.rate >= 70 ? "text-status-success" : "text-status-warning"}`}>
                  합격률 {at.rate}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Summary Card ──
function SummaryCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="bg-bg-primary rounded-lg border border-border-default p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={18} className={color} />
        <span className="text-caption text-text-tertiary">{label}</span>
      </div>
      <div className={`text-title ${color}`}>{value}</div>
      <div className="text-caption text-text-tertiary mt-1">{sub}</div>
    </div>
  );
}
