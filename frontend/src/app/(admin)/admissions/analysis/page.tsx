"use client";

/**
 * 합격자 분석 — 학교 진학기록(AdmissionsRecord) 실데이터 집계.
 * GET /api/admissions/analysis (대학별/연도별/전형별 합격 현황).
 */

import { useEffect, useState } from "react";
import { TrendingUp, School, BarChart3, Target, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface UniStat { university: string; applied: number; accepted: number; rate: number }
interface YearStat { year: number; applied: number; accepted: number; rate: number }
interface TypeStat { admission_type: string; applied: number; accepted: number; rate: number }
interface AnalysisData {
  record_count: number;
  total_applied: number;
  total_accepted: number;
  overall_rate: number;
  universities: UniStat[];
  years: YearStat[];
  admission_types: TypeStat[];
}

export default function AdmissionsAnalysisPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<AnalysisData>("/api/admissions/analysis")
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="py-20 text-center"><Loader2 size={28} className="mx-auto text-accent animate-spin" /></div>;
  }

  if (!data || data.record_count === 0 || data.total_applied === 0) {
    return (
      <div>
        <h1 className="text-title text-text-primary mb-6">합격자 분석</h1>
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 text-center">
          <BarChart3 size={32} className="mx-auto text-text-tertiary opacity-30 mb-3" />
          <div className="text-body text-text-secondary mb-1">집계할 진학기록이 없습니다</div>
          <div className="text-caption text-text-tertiary">
            "진학 관리 → 진학기록"에 졸업생 합격 결과가 등록되면 자동으로 집계됩니다.
          </div>
        </div>
      </div>
    );
  }

  const latest = data.years[data.years.length - 1];
  const prev = data.years.length >= 2 ? data.years[data.years.length - 2] : null;
  const rateDiff = prev ? (latest.rate - prev.rate).toFixed(1) : null;
  const topUnis = data.universities.slice(0, 3);
  const maxYearRate = Math.max(1, ...data.years.map((y) => y.rate));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">합격자 분석</h1>
        <span className="text-caption text-text-tertiary">진학기록 {data.record_count}명 기준</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard icon={Target} label="총 지원" value={`${data.total_applied}건`} sub={`${data.record_count}명`} color="text-blue-600" />
        <SummaryCard icon={School} label="합격" value={`${data.total_accepted}건`} sub={`합격률 ${data.overall_rate}%`} color="text-green-600" />
        {rateDiff !== null ? (
          <SummaryCard
            icon={TrendingUp} label="전년 대비"
            value={`${Number(rateDiff) >= 0 ? "+" : ""}${rateDiff}%p`}
            sub={`${prev!.rate}% → ${latest.rate}%`}
            color={Number(rateDiff) >= 0 ? "text-status-success" : "text-status-error"}
          />
        ) : (
          <SummaryCard icon={TrendingUp} label="최근 연도" value={`${latest.rate}%`} sub={`${latest.year}년 합격률`} color="text-status-success" />
        )}
        <SummaryCard
          icon={BarChart3} label="상위 대학 합격"
          value={`${topUnis.reduce((s, u) => s + u.accepted, 0)}건`}
          sub={topUnis.map((u) => u.university).join("/") || "-"}
          color="text-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* University acceptance rates */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <h2 className="text-body font-semibold text-text-primary mb-4">대학별 합격 현황</h2>
          {data.universities.length === 0 ? (
            <div className="text-caption text-text-tertiary py-4 text-center">대학 정보가 있는 기록이 없습니다.</div>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {data.universities.map((uni) => (
                <div key={uni.university} className="flex items-center gap-3">
                  <span className="text-body text-text-primary w-28 flex-shrink-0 truncate" title={uni.university}>{uni.university}</span>
                  <div className="flex-1 h-6 bg-bg-secondary rounded-full overflow-hidden relative">
                    <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${uni.rate}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-caption font-medium text-text-primary">
                      {uni.accepted}/{uni.applied}
                    </span>
                  </div>
                  <span className="text-caption text-text-secondary w-14 text-right">{uni.rate}%</span>
                </div>
              ))}
            </div>
          )}
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
                {data.years.map((y) => (
                  <tr key={y.year} className="border-t border-border-default hover:bg-bg-secondary">
                    <td className="px-4 py-2 text-body text-text-primary">{y.year}</td>
                    <td className="px-4 py-2 text-body text-text-secondary text-right">{y.applied}건</td>
                    <td className="px-4 py-2 text-body text-text-primary text-right">{y.accepted}건</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`text-body font-medium ${y.rate >= 70 ? "text-status-success" : "text-status-warning"}`}>{y.rate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <h3 className="text-caption text-text-tertiary mb-2">합격률 추이</h3>
            <div className="flex items-end gap-2 h-24">
              {data.years.map((y) => (
                <div key={y.year} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-caption text-text-secondary">{y.rate}%</span>
                  <div className="w-full bg-accent rounded-t transition-all" style={{ height: `${(y.rate / maxYearRate) * 80}px` }} />
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
            {data.admission_types.map((at) => (
              <div key={at.admission_type} className="bg-bg-secondary rounded-lg p-4 text-center">
                <div className="text-caption text-text-tertiary mb-1">{at.admission_type}</div>
                <div className="text-title text-text-primary">{at.accepted}/{at.applied}</div>
                <div className={`text-body font-medium mt-1 ${at.rate >= 70 ? "text-status-success" : "text-status-warning"}`}>합격률 {at.rate}%</div>
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
      <div className="text-caption text-text-tertiary mt-1 truncate" title={sub}>{sub}</div>
    </div>
  );
}
