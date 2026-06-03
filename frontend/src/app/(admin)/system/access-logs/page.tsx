"use client";

/**
 * 접속 로그 — 구성원 로그인(접속) 기록. super_admin/시스템 감사 권한 전용.
 * 감사 로그(모든 액션)와 별개로 '누가 언제 어디(IP)서 접속했나'에 집중.
 */

import { useCallback, useEffect, useState } from "react";
import { LogIn, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/client";
import { DataTable } from "@/components/ui/DataTable";

interface AccessLogItem {
  id: number;
  timestamp: string | null;
  name: string | null;
  user_email: string | null;
  user_role: string | null;
  ip: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "최고관리자",
  designated_admin: "지정관리자",
  teacher: "교사",
  staff: "직원",
  student: "학생",
};

function fmt(dt: string | null) {
  if (!dt) return "-";
  return new Date(dt).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function AccessLogsPage() {
  const [items, setItems] = useState<AccessLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 50;
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (search) params.set("search", search);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const data = await api.get(`/api/system/access-logs?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo]);

  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <LogIn size={22} /> 접속 로그
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            구성원 로그인(접속) 기록 — 누가 언제 어디(IP)서 접속했는지. 최신순.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-3 mb-4 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름 또는 이메일 검색"
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary min-w-[220px]"
        />
        <div className="flex items-center gap-1">
          <label className="text-caption text-text-secondary">기간:</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary" />
          <span className="text-text-tertiary">~</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary" />
        </div>
        <button
          onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}
          className="px-2 py-1 text-caption text-text-tertiary hover:text-text-primary"
        >
          필터 초기화
        </button>
        <span className="text-caption text-text-tertiary ml-auto">총 {total}건</span>
      </div>

      <DataTable<AccessLogItem>
        searchable
        searchPlaceholder="이름·이메일·IP 검색"
        exportable
        exportFileName="access_logs.csv"
        columns={[
          {
            key: "timestamp", label: "접속 시각", sortable: true,
            sortValue: (l) => l.timestamp ?? "",
            render: (l) => <span className="text-caption text-text-secondary whitespace-nowrap">{fmt(l.timestamp)}</span>,
            csvValue: (l) => l.timestamp ?? "",
          },
          { key: "name", label: "이름", sortable: true, render: (l) => <span className="text-text-primary">{l.name || "-"}</span> },
          { key: "user_role", label: "역할", render: (l) => <span className="text-caption">{ROLE_LABELS[l.user_role || ""] || l.user_role || "-"}</span> },
          { key: "user_email", label: "이메일", render: (l) => <span className="text-caption text-text-secondary">{l.user_email || "-"}</span> },
          { key: "ip", label: "IP", render: (l) => <span className="text-caption text-text-tertiary font-mono">{l.ip || "-"}</span> },
        ]}
        rows={items}
        keyExtractor={(l) => l.id}
        loading={loading}
        emptyText="접속 기록이 없습니다"
        page={page}
        totalPages={totalPages}
        totalCount={total}
        onPageChange={setPage}
      />
    </div>
  );
}
