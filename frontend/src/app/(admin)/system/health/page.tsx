"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Activity,
  Server,
  Cpu,
  DollarSign,
  RefreshCw,
} from "lucide-react";

interface HealthData {
  status: string;
  school: string;
  version: string;
}

interface CostData {
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [cost, setCost] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, costData] = await Promise.all([
        api.get("/api/system/health"),
        api.get("/api/pipeline/cost").catch(() => null),
      ]);
      setHealth(healthData);
      if (costData) setCost(costData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">시스템 상태</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-caption text-text-tertiary">
              마지막 갱신: {lastUpdated.toLocaleTimeString("ko-KR")}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
        </div>
      </div>

      {/* 상태 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="flex items-center gap-3">
            <Activity
              size={24}
              className={
                health?.status === "ok"
                  ? "text-status-success"
                  : "text-status-error"
              }
            />
            <div>
              <div className="text-caption text-text-tertiary">서버 상태</div>
              <div
                className={`text-body font-semibold ${
                  health?.status === "ok"
                    ? "text-status-success"
                    : "text-status-error"
                }`}
              >
                {health ? (health.status === "ok" ? "정상" : health.status) : "-"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="flex items-center gap-3">
            <Server size={24} className="text-accent" />
            <div>
              <div className="text-caption text-text-tertiary">학교</div>
              <div className="text-body font-semibold text-text-primary">
                {health?.school ?? "-"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="flex items-center gap-3">
            <Cpu size={24} className="text-status-warning" />
            <div>
              <div className="text-caption text-text-tertiary">버전</div>
              <div className="text-body font-semibold text-text-primary">
                {health?.version ?? "-"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="flex items-center gap-3">
            <DollarSign size={24} className="text-accent" />
            <div>
              <div className="text-caption text-text-tertiary">AI 총 비용</div>
              <div className="text-body font-semibold text-text-primary">
                {cost ? `$${cost.total_cost.toFixed(4)}` : "-"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI 사용량 상세 */}
      {cost && (
        <div className="bg-bg-primary rounded-lg border border-border-default p-6 mb-8">
          <h2 className="text-body font-semibold text-text-primary mb-4">
            AI 토큰 사용량
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-caption text-text-tertiary mb-1">
                입력 토큰
              </div>
              <div className="text-body font-semibold text-text-primary">
                {formatTokens(cost.total_input_tokens)}
              </div>
              <div className="mt-2 h-2 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{
                    width: `${Math.min(
                      (cost.total_input_tokens /
                        (cost.total_input_tokens + cost.total_output_tokens)) *
                        100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="text-caption text-text-tertiary mb-1">
                출력 토큰
              </div>
              <div className="text-body font-semibold text-text-primary">
                {formatTokens(cost.total_output_tokens)}
              </div>
              <div className="mt-2 h-2 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full"
                  style={{
                    width: `${Math.min(
                      (cost.total_output_tokens /
                        (cost.total_input_tokens + cost.total_output_tokens)) *
                        100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="text-caption text-text-tertiary mb-1">
                총 토큰
              </div>
              <div className="text-body font-semibold text-text-primary">
                {formatTokens(
                  cost.total_input_tokens + cost.total_output_tokens
                )}
              </div>
              <div className="mt-2 h-2 bg-bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full w-full" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 시스템 정보 */}
      <div className="bg-bg-primary rounded-lg border border-border-default p-6">
        <h2 className="text-body font-semibold text-text-primary mb-3">
          시스템 정보
        </h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1 border-b border-border-default">
            <span className="text-caption text-text-tertiary">플랫폼</span>
            <span className="text-caption text-text-primary">
              General School Platform
            </span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-border-default">
            <span className="text-caption text-text-tertiary">버전</span>
            <span className="text-caption text-text-primary">
              {health?.version ?? "-"}
            </span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-border-default">
            <span className="text-caption text-text-tertiary">학교</span>
            <span className="text-caption text-text-primary">
              {health?.school ?? "-"}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-caption text-text-tertiary">상태</span>
            <span
              className={`text-caption ${
                health?.status === "ok"
                  ? "text-status-success"
                  : "text-status-error"
              }`}
            >
              {health?.status === "ok" ? "정상 운영" : health?.status ?? "-"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
