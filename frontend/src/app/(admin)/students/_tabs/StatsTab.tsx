"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus, X, Award, FileText, MessageSquare, BarChart3, BookOpen,
  Notebook, Briefcase, Target, Eye, Globe, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { downloadSecure } from "@/lib/api/download";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export function StatsTab({ studentId }: { studentId: number }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/students/${studentId}/stats`)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!stats) return <div className="text-text-tertiary">통계 데이터 없음</div>;

  const maxAvg = Math.max(...stats.grade_trend.map((d: any) => d.avg), 100);

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">총 성적 기록</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.grades}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">수상</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.awards}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">상담</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.counselings}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">모의고사</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.mock_exams}</div>
        </div>
      </div>

      {/* 학기별 평균 추이 */}
      {stats.grade_trend.length > 0 && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h3 className="text-body font-semibold mb-3">학기별 평균 점수 추이</h3>
          <div className="flex items-end gap-2 h-32">
            {stats.grade_trend.map((d: any) => (
              <div key={d.period} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="text-caption text-text-tertiary opacity-0 group-hover:opacity-100">{d.avg}점</div>
                <div className="w-full bg-accent rounded-t" style={{ height: `${(d.avg / maxAvg) * 100}%`, minHeight: "2px" }} />
                <div className="text-caption text-text-tertiary">{d.period}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 모의고사 등급 추이 */}
      {stats.mock_trend.length > 0 && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h3 className="text-body font-semibold mb-3">모의고사 등급 추이 (시점별)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="text-caption text-text-tertiary"><tr><th className="text-left p-1">날짜</th><th className="text-left p-1">과목</th><th className="text-right p-1">백분위</th><th className="text-right p-1">등급</th></tr></thead>
              <tbody>
                {stats.mock_trend.map((m: any, i: number) => (
                  <tr key={i} className="border-t border-border-default">
                    <td className="p-1 text-text-tertiary">{m.date}</td>
                    <td className="p-1">{m.subject}</td>
                    <td className="p-1 text-right">{m.percentile ?? "-"}</td>
                    <td className="p-1 text-right">{m.grade_level ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 수상 카테고리별 */}
      {Object.keys(stats.award_by_category).length > 0 && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h3 className="text-body font-semibold mb-3">수상 분야별</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.award_by_category).map(([k, v]: any) => (
              <span key={k} className="px-3 py-1 bg-accent-light text-accent rounded text-caption">{k}: {v}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Records Tab (생기부) ──
