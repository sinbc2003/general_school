"use client";

/**
 * 권한 변경 이력 timeline 탭.
 *
 * audit_log에서 권한 관련 action만 필터링해 날짜별 timeline으로 표시.
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api/client";
import { UserSearchInput } from "@/components/admin/UserSearchInput";

interface AuditItem {
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

const ACTION_LABELS: Record<string, { label: string; group: string; color: string }> = {
  user_created: { label: "사용자 생성", group: "사용자", color: "bg-blue-100 text-blue-700" },
  user_updated: { label: "사용자 수정", group: "사용자", color: "bg-blue-100 text-blue-700" },
  user_disabled: { label: "사용자 비활성", group: "사용자", color: "bg-amber-100 text-amber-700" },
  "user.force_logout": { label: "강제 로그아웃", group: "사용자", color: "bg-red-100 text-red-700" },
  password_reset: { label: "비번 리셋", group: "사용자", color: "bg-amber-100 text-amber-700" },
  password_changed: { label: "비번 변경", group: "사용자", color: "bg-gray-100 text-gray-700" },
  user_permissions_updated: { label: "사용자 권한 변경", group: "권한", color: "bg-purple-100 text-purple-700" },
  role_permissions_updated: { label: "역할 권한 변경", group: "권한", color: "bg-purple-100 text-purple-700" },
  permission_group_created: { label: "그룹 생성", group: "권한 그룹", color: "bg-cyan-100 text-cyan-700" },
  permission_group_updated: { label: "그룹 수정", group: "권한 그룹", color: "bg-cyan-100 text-cyan-700" },
  permission_group_deleted: { label: "그룹 삭제", group: "권한 그룹", color: "bg-red-100 text-red-700" },
  permission_group_assigned: { label: "그룹 할당", group: "권한 그룹", color: "bg-cyan-100 text-cyan-700" },
  permission_group_unassigned: { label: "그룹 해제", group: "권한 그룹", color: "bg-cyan-100 text-cyan-700" },
  "position_template.create": { label: "직책 생성", group: "직책", color: "bg-amber-100 text-amber-700" },
  "position_template.update": { label: "직책 수정", group: "직책", color: "bg-amber-100 text-amber-700" },
  "position_template.delete": { label: "직책 삭제", group: "직책", color: "bg-red-100 text-red-700" },
  "position_template.apply_to_department": { label: "직책 부서 일괄", group: "직책", color: "bg-amber-100 text-amber-700" },
  "enrollment_position.set": { label: "명단 직책 변경", group: "직책", color: "bg-amber-100 text-amber-700" },
  "enrollment_position.sync_year": { label: "직책 학년도 동기화", group: "직책", color: "bg-amber-100 text-amber-700" },
  "policy.designated_admin_mode": { label: "지정관리자 모드 변경", group: "정책", color: "bg-rose-100 text-rose-700" },
  "policy.admin_2fa_required": { label: "admin 2FA 정책", group: "정책", color: "bg-rose-100 text-rose-700" },
  "policy.password": { label: "비번 정책", group: "정책", color: "bg-rose-100 text-rose-700" },
  login: { label: "로그인", group: "인증", color: "bg-gray-100 text-gray-700" },
  "login.email_challenge_sent": { label: "이메일 코드 발송", group: "인증", color: "bg-gray-100 text-gray-700" },
  "login.email_challenge_resent": { label: "이메일 코드 재발송", group: "인증", color: "bg-gray-100 text-gray-700" },
  "2fa_enabled": { label: "2FA 활성화", group: "인증", color: "bg-emerald-100 text-emerald-700" },
  "2fa_verified": { label: "2FA 검증", group: "인증", color: "bg-emerald-100 text-emerald-700" },
  "2fa_disabled": { label: "2FA 비활성화", group: "인증", color: "bg-amber-100 text-amber-700" },
  "device.trusted_added": { label: "신뢰장치 등록", group: "장치", color: "bg-indigo-100 text-indigo-700" },
  "device.trusted_revoked": { label: "신뢰장치 취소", group: "장치", color: "bg-indigo-100 text-indigo-700" },
  "device.trusted_revoked_all": { label: "신뢰장치 일괄 취소", group: "장치", color: "bg-indigo-100 text-indigo-700" },
  "semester.create": { label: "학기 생성", group: "학기", color: "bg-teal-100 text-teal-700" },
  "semester.archive": { label: "학기 보관", group: "학기", color: "bg-teal-100 text-teal-700" },
  "semester.unarchive": { label: "학기 보관 해제", group: "학기", color: "bg-teal-100 text-teal-700" },
};

export function PermissionAuditHistoryTab() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("");
  const [filterActor, setFilterActor] = useState("");
  const [filterUserId, setFilterUserId] = useState<number | "">("");
  const [filterUserName, setFilterUserName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAction) params.set("action_filter", filterAction);
      if (filterActor) params.set("actor_email", filterActor);
      if (filterUserId) params.set("user_id", String(filterUserId));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      params.set("page", String(page));
      params.set("per_page", "50");
      const data = await api.get<{
        items: AuditItem[]; total: number; page: number; per_page: number;
      }>(`/api/permissions/audit-history?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterActor, filterUserId, dateFrom, dateTo, page]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  // 날짜별 그룹핑 (timeline 헤더)
  const grouped = new Map<string, AuditItem[]>();
  for (const it of items) {
    const date = it.timestamp?.slice(0, 10) || "(날짜 없음)";
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(it);
  }

  return (
    <div>
      <div className="mb-4 p-3 bg-cream-100 border border-cream-300 rounded-lg">
        <div className="text-caption text-text-secondary">
          <b>변경 이력</b> — 권한·역할·직책·정책·세션·인증 관련 이벤트만 모아 보여줍니다.
          전체 audit log는 <a href="/system/logs" className="text-accent underline">시스템 → 감사 로그</a>를 참고하세요.
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className="block text-caption text-text-secondary mb-1">대상 사용자</label>
            <UserSearchInput
              value={filterUserId}
              onSelect={(u) => {
                if (u) {
                  setFilterUserId(u.id);
                  setFilterUserName(u.name);
                } else {
                  setFilterUserId("");
                  setFilterUserName("");
                }
                setPage(1);
              }}
              placeholder="대상자 검색..."
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">변경자 이메일</label>
            <input
              type="text"
              value={filterActor}
              onChange={(e) => {
                setFilterActor(e.target.value);
                setPage(1);
              }}
              placeholder="part-of-email@..."
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">액션</label>
            <input
              type="text"
              value={filterAction}
              onChange={(e) => {
                setFilterAction(e.target.value);
                setPage(1);
              }}
              placeholder="permission, role, 2fa..."
              className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div className="flex gap-1">
            <div className="flex-1">
              <label className="block text-caption text-text-secondary mb-1">시작일</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div className="flex-1">
              <label className="block text-caption text-text-secondary mb-1">종료일</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="w-full px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="text-caption text-text-tertiary">
            {filterUserName && <>대상자: <b>{filterUserName}</b> · </>}
            총 <b>{total.toLocaleString()}</b>건
          </div>
          <button
            onClick={() => fetchAll()}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
        </div>
      </div>

      {/* timeline */}
      {loading && items.length === 0 ? (
        <div className="py-12 text-center text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-text-tertiary border border-dashed border-border-default rounded">
          조건에 맞는 변경 이력이 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(grouped.entries()).map(([date, dayItems]) => (
            <div key={date}>
              <div className="text-caption font-semibold text-text-secondary mb-1.5">
                {date}
              </div>
              <div className="bg-bg-primary border border-border-default rounded divide-y divide-border-default">
                {dayItems.map((it) => {
                  const meta = ACTION_LABELS[it.action] || {
                    label: it.action, group: "기타",
                    color: "bg-gray-100 text-gray-700",
                  };
                  return (
                    <div key={it.id} className="flex items-start gap-3 px-3 py-2 hover:bg-bg-secondary">
                      <div className="text-caption text-text-tertiary font-mono w-16 flex-shrink-0 pt-0.5">
                        {it.timestamp?.slice(11, 19)}
                      </div>
                      <div className="flex-shrink-0">
                        <span className={`inline-block text-caption px-1.5 py-0.5 rounded ${meta.color}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-body text-text-primary">
                          <b>{it.user_email || "(시스템)"}</b>
                          {it.user_role && (
                            <span className="text-caption text-text-tertiary ml-1">[{it.user_role}]</span>
                          )}
                          {it.target && (
                            <>
                              <span className="text-text-tertiary mx-1">→</span>
                              <span className="text-text-secondary font-mono text-caption">{it.target}</span>
                            </>
                          )}
                        </div>
                        {it.detail && (
                          <div className="text-caption text-text-tertiary mt-0.5">{it.detail}</div>
                        )}
                        {it.ip && (
                          <div className="text-caption text-text-tertiary mt-0.5">IP: {it.ip}</div>
                        )}
                      </div>
                      {it.is_sensitive && (
                        <span title="민감 이벤트" className="text-caption text-status-warning">⚠</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 페이징 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-30"
          >
            ← 이전
          </button>
          <span className="text-caption text-text-tertiary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-30"
          >
            다음 →
          </button>
        </div>
      )}
    </div>
  );
}
