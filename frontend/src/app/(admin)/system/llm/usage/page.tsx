"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

interface UsageData {
  days: number;
  total_cost_usd: number;
  total_messages: number;
  by_day: { date: string; cost_usd: number; messages: number }[];
  by_model: { provider: string; model_id: string; cost_usd: number; input_tokens: number; output_tokens: number; messages: number }[];
  by_user: { user_id: number; username: string; name: string; cost_usd: number; messages: number }[];
}

export default function LLMUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    api.get(`/api/chatbot/usage/all?days=${days}`).then(setData);
  }, [days]);

  if (!data) return <div>로딩 중...</div>;

  const maxDailyCost = Math.max(...data.by_day.map((d) => d.cost_usd), 0.001);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-title text-text-primary">사용량 / 비용</h1>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}
                className="px-3 py-1.5 border border-border-default rounded">
          <option value="7">최근 7일</option>
          <option value="30">최근 30일</option>
          <option value="90">최근 90일</option>
          <option value="365">최근 1년</option>
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <div className="text-caption text-text-tertiary">총 비용 (USD)</div>
          <div className="text-2xl font-bold text-accent mt-1">${data.total_cost_usd.toFixed(2)}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <div className="text-caption text-text-tertiary">총 메시지</div>
          <div className="text-2xl font-bold text-text-primary mt-1">{data.total_messages.toLocaleString()}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <div className="text-caption text-text-tertiary">사용자 수</div>
          <div className="text-2xl font-bold text-text-primary mt-1">{data.by_user.length}</div>
        </div>
      </div>

      {/* 일별 차트 (간단 막대) */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-4 mb-6">
        <h2 className="text-body font-semibold mb-3">일별 비용</h2>
        <div className="flex items-end gap-1 h-40">
          {data.by_day.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group" title={`${d.date}: $${d.cost_usd.toFixed(4)}`}>
              <div className="text-[0.6rem] text-text-tertiary opacity-0 group-hover:opacity-100">${d.cost_usd.toFixed(3)}</div>
              <div
                className="w-full bg-accent rounded-t"
                style={{ height: `${(d.cost_usd / maxDailyCost) * 100}%`, minHeight: "2px" }}
              />
              <div className="text-[0.55rem] text-text-tertiary">{d.date.slice(5)}</div>
            </div>
          ))}
          {data.by_day.length === 0 && (
            <div className="flex-1 text-center text-text-tertiary py-8">데이터 없음</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 모델별 */}
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h2 className="text-body font-semibold mb-3">모델별</h2>
          <table className="w-full text-body">
            <thead className="text-caption text-text-secondary">
              <tr><th className="text-left p-1">Provider/Model</th><th className="text-right p-1">메시지</th><th className="text-right p-1">In tok</th><th className="text-right p-1">Out tok</th><th className="text-right p-1">$</th></tr>
            </thead>
            <tbody>
              {data.by_model.map((m) => (
                <tr key={`${m.provider}/${m.model_id}`} className="border-t border-border-default">
                  <td className="p-1 font-mono text-caption">{m.provider}/{m.model_id}</td>
                  <td className="p-1 text-right">{m.messages}</td>
                  <td className="p-1 text-right text-caption">{m.input_tokens.toLocaleString()}</td>
                  <td className="p-1 text-right text-caption">{m.output_tokens.toLocaleString()}</td>
                  <td className="p-1 text-right text-accent font-medium">${m.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 사용자별 Top */}
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h2 className="text-body font-semibold mb-3">사용자별 Top {data.by_user.length}</h2>
          <table className="w-full text-body">
            <thead className="text-caption text-text-secondary">
              <tr><th className="text-left p-1">사용자</th><th className="text-right p-1">메시지</th><th className="text-right p-1">$</th></tr>
            </thead>
            <tbody>
              {data.by_user.map((u) => (
                <tr key={u.user_id} className="border-t border-border-default">
                  <td className="p-1">{u.name} <span className="text-caption text-text-tertiary">({u.username})</span></td>
                  <td className="p-1 text-right">{u.messages}</td>
                  <td className="p-1 text-right text-accent font-medium">${u.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
