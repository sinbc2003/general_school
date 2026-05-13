"use client";

/**
 * 감사 로그 페이지 — super_admin/시스템 감사 전용.
 * 모든 민감 액션(가입/2FA/권한 변경/학생 데이터 접근 등) 기록 조회.
 */

import { useCallback, useEffect, useState } from "react";
import { FileText, AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/client";
import { DataTable } from "@/components/ui/DataTable";

interface AuditLogItem {
  id: number;
  timestamp: string | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  is_sensitive: boolean;
}

function formatDateTime(dt: string | null) {
  if (!dt) return "-";
  return new Date(dt).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function AuditLogsPage() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (actionFilter) params.set("action", actionFilter);
      const data = await api.get(`/api/system/audit-logs?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, perPage, actionFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <FileText size={22} /> 감사 로그
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            가입·로그인·2FA·권한 변경·학생 데이터 접근 등 민감 액션 기록. 최신순.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          placeholder="action 필터 (예: login, semester.create)"
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary min-w-[260px]"
        />
        <span className="text-caption text-text-tertiary ml-auto">총 {total}건</span>
      </div>

      <DataTable<AuditLogItem>
        searchable
        searchPlaceholder="유저·액션·대상·detail 검색"
        exportable
        exportFileName="audit_logs.csv"
        columns={[
          {
            key: "timestamp", label: "시각", sortable: true,
            sortValue: (l) => l.timestamp ?? "",
            render: (l) => <span className="text-caption text-text-tertiary whitespace-nowrap">{formatDateTime(l.timestamp)}</span>,
            csvValue: (l) => l.timestamp ?? "",
          },
          {
            key: "user_email", label: "사용자", sortable: true,
            render: (l) => (
              <div>
                <div className="text-text-primary">{l.user_email || "-"}</div>
                {l.user_role && <div className="text-caption text-text-tertiary">{l.user_role}</div>}
              </div>
            ),
          },
          {
            key: "action", label: "action", sortable: true,
            render: (l) => (
              <span className={`inline-block px-2 py-0.5 text-caption rounded font-mono ${
                l.is_sensitive ? "bg-red-50 text-red-700 border border-red-200" : "bg-gray-100 text-gray-700"
              }`}>
                {l.is_sensitive && <AlertTriangle size={10} className="inline mr-0.5" />}
                {l.action}
              </span>
            ),
          },
          { key: "target", label: "대상", render: (l) => <span className="text-caption font-mono text-text-secondary">{l.target || "-"}</span> },
          { key: "detail", label: "detail", render: (l) => <span className="text-caption text-text-tertiary line-clamp-2 max-w-md">{l.detail || "-"}</span> },
          { key: "ip", label: "IP", render: (l) => <span className="text-caption text-text-tertiary font-mono">{l.ip || "-"}</span> },
        ]}
        rows={items}
        keyExtractor={(l) => l.id}
        loading={loading}
        emptyText="감사 로그가 없습니다"
        page={page}
        totalPages={totalPages}
        totalCount={total}
        onPageChange={setPage}
      />
    </div>
  );
}
