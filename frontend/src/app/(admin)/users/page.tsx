"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { PermissionGate } from "@/components/common/permission-gate";
import { Upload, Download, Search, RotateCcw, UserX, HardDrive } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { InlineCell } from "@/components/ui/InlineCell";
import type { UserItem } from "@/types";
import { CsvBulkImportModal } from "./_components/CsvBulkImportModal";
import { LifecycleModal } from "./_components/LifecycleModal";
import { QuotaBulkModal } from "./_components/QuotaBulkModal";


// MB 단위 포맷 (작은 값은 MB, 1024 이상은 GB로)
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  return `${Math.round(mb)}MB`;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "최고관리자",
  designated_admin: "지정관리자",
  teacher: "교사",
  staff: "직원",
  student: "학생",
};

const STATUS_LABELS: Record<string, string> = {
  approved: "활성",
  disabled: "비활성",
};

export default function UsersPage() {
  const { isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<UserItem | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showQuotaBulkModal, setShowQuotaBulkModal] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: "20" });
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      const data = await api.get(`/api/users?${params}`);
      setUsers(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // 먼저 검증
      const validation = await api.upload("/api/users/bulk-import/validate", file);
      setImportResult(validation);

      if (validation.valid_count > 0 && validation.error_count === 0) {
        // 오류 없으면 바로 등록
        const result = await api.upload("/api/users/bulk-import/confirm", file);
        alert(`${result.created}명 등록 완료`);
        fetchUsers();
      } else if (validation.valid_count > 0) {
        if (confirm(`유효: ${validation.valid_count}명, 오류: ${validation.error_count}건\n유효한 데이터만 등록하시겠습니까?`)) {
          const result = await api.upload("/api/users/bulk-import/confirm", file);
          alert(`${result.created}명 등록 완료`);
          fetchUsers();
        }
      } else {
        alert("등록 가능한 데이터가 없습니다. 오류를 확인하세요.");
      }
    } catch (err: any) {
      alert(err?.detail || "엑셀 업로드 실패");
    }

    e.target.value = "";
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002"}/api/users/excel-template`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          },
        }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "user_import_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("템플릿 다운로드 실패");
    }
  };

  const handleResetPassword = async (u: UserItem) => {
    // 전화번호(숫자만) 있으면 그것으로 초기화, 없으면 관리자가 임시 비번 입력.
    const phoneDigits = (u.phone || "").replace(/\D/g, "");
    let body: { password?: string } = {};
    if (phoneDigits) {
      if (!confirm(`${u.name}님의 비밀번호를 전화번호(${phoneDigits})로 초기화할까요?`)) return;
    } else {
      const input = window.prompt(`${u.name}님은 전화번호가 없습니다.\n초기화할 임시 비밀번호를 입력하세요:`);
      if (input === null) return; // 취소
      const pw = input.trim();
      if (!pw) { alert("비밀번호를 입력해야 합니다."); return; }
      body = { password: pw };
    }
    try {
      const result = await api.post<{ password: string; source: string }>(
        `/api/users/${u.id}/reset-password`, body,
      );
      alert(`초기화 완료 — ${result.source === "phone" ? "전화번호" : "지정"} 비밀번호: ${result.password}\n사용자는 첫 로그인 시 변경하게 됩니다.`);
    } catch (err: any) {
      alert(err?.detail || "실패");
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">사용자 관리</h1>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <button
              onClick={() => setShowCsvModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
            >
              <Upload size={14} />
              CSV 일괄 등록
            </button>
          )}
          <PermissionGate permission="user.manage.quota">
            <button
              onClick={() => setShowQuotaBulkModal(true)}
              title="역할별로 드라이브 용량 일괄 변경"
              className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
            >
              <HardDrive size={14} />
              용량 일괄
            </button>
          </PermissionGate>
          <PermissionGate permission="user.manage.bulk_import">
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
            >
              <Download size={14} />
              엑셀 템플릿
            </button>
            <label className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded cursor-pointer hover:bg-bg-secondary">
              <Upload size={14} />
              엑셀 등록
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={handleExcelImport}
              />
            </label>
          </PermissionGate>
        </div>
      </div>

      {showCsvModal && (
        <CsvBulkImportModal onClose={() => { setShowCsvModal(false); fetchUsers(); }} />
      )}

      {showQuotaBulkModal && (
        <QuotaBulkModal
          onClose={() => setShowQuotaBulkModal(false)}
          onApplied={() => fetchUsers()}
        />
      )}

      {/* 필터 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1">
          <Search size={16} className="text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="이름 또는 이메일 검색"
            className="flex-1 px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체 역할</option>
          <option value="teacher">교사</option>
          <option value="staff">직원</option>
          <option value="student">학생</option>
          {isSuperAdmin && <option value="designated_admin">지정관리자</option>}
        </select>
      </div>

      {/* 검증 결과 */}
      {importResult && importResult.errors.length > 0 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-caption">
          <div className="font-medium text-status-error mb-1">
            엑셀 검증 오류 ({importResult.error_count}건)
          </div>
          {importResult.errors.slice(0, 5).map((err: any, i: number) => (
            <div key={i} className="text-text-secondary">
              행 {err.row}: [{err.field}] {err.message}
            </div>
          ))}
          {importResult.errors.length > 5 && (
            <div className="text-text-tertiary">... 외 {importResult.errors.length - 5}건</div>
          )}
          <button
            onClick={() => setImportResult(null)}
            className="mt-1 text-accent text-caption"
          >
            닫기
          </button>
        </div>
      )}

      <DataTable<UserItem>
        searchable
        searchPlaceholder="이름·이메일 검색"
        exportable
        exportFileName="users.csv"
        columns={[
          { key: "name", label: "이름", sortable: true },
          { key: "email", label: "이메일", render: (u) => <span className="text-text-secondary">{u.email}</span> },
          {
            key: "role", label: "역할",
            render: (u) => (
              <span className={`inline-block px-2 py-0.5 text-caption rounded ${
                u.role === "super_admin" ? "bg-red-100 text-red-700" :
                u.role === "designated_admin" ? "bg-purple-100 text-purple-700" :
                u.role === "teacher" ? "bg-cream-200 text-blue-700" :
                u.role === "staff" ? "bg-green-100 text-green-700" :
                "bg-gray-100 text-gray-700"
              }`}>
                {ROLE_LABELS[u.role] || u.role}
              </span>
            ),
          },
          {
            key: "status", label: "상태",
            render: (u) => (
              <span className={`text-caption ${u.status === "approved" ? "text-status-success" : "text-status-error"}`}>
                {STATUS_LABELS[u.status] || u.status}
              </span>
            ),
          },
          {
            key: "grade", label: "학년/반/번호",
            render: (u) => (
              <div className="flex items-center gap-1">
                <InlineCell
                  value={u.grade}
                  type="number"
                  width="w-12"
                  placeholder="-"
                  onSave={async (v) => {
                    const grade = v ? parseInt(v) : null;
                    await api.put(`/api/users/${u.id}`, { grade });
                    setUsers((p) => p.map((x) => x.id === u.id ? { ...x, grade } : x));
                  }}
                />
                <span>-</span>
                <InlineCell
                  value={u.class_number}
                  type="number"
                  width="w-12"
                  placeholder="?"
                  onSave={async (v) => {
                    const cn = v ? parseInt(v) : null;
                    await api.put(`/api/users/${u.id}`, { class_number: cn });
                    setUsers((p) => p.map((x) => x.id === u.id ? { ...x, class_number: cn } : x));
                  }}
                />
                <span>-</span>
                <InlineCell
                  value={u.student_number}
                  type="number"
                  width="w-14"
                  placeholder="?"
                  onSave={async (v) => {
                    const sn = v ? parseInt(v) : null;
                    await api.put(`/api/users/${u.id}`, { student_number: sn });
                    setUsers((p) => p.map((x) => x.id === u.id ? { ...x, student_number: sn } : x));
                  }}
                />
              </div>
            ),
          },
          {
            key: "department", label: "부서",
            render: (u) => (
              <InlineCell
                value={u.department}
                width="w-28"
                placeholder="-"
                onSave={async (v) => {
                  await api.put(`/api/users/${u.id}`, { department: v || null });
                  setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, department: v || null } : x));
                }}
              />
            ),
          },
          {
            key: "quota", label: "드라이브",
            render: (u) => {
              const quota = u.quota_bytes ?? 0;
              const used = u.used_bytes ?? 0;
              const isUnlimited = quota === 0;
              const isSuper = u.role === "super_admin";
              const quotaMb = isUnlimited ? 0 : Math.round(quota / 1024 / 1024);
              const overQuota = !isUnlimited && used > quota;
              return (
                <div className="flex items-center gap-2">
                  <div className="text-caption text-text-secondary min-w-[90px]">
                    <span className={overQuota ? "text-status-error font-medium" : ""}>
                      {formatBytes(used)}
                    </span>
                    {" / "}
                    <span>{isUnlimited ? "무제한" : formatBytes(quota)}</span>
                  </div>
                  {!isSuper && isSuperAdmin && (
                    <InlineCell
                      value={quotaMb}
                      type="number"
                      width="w-16"
                      placeholder="MB"
                      onSave={async (v) => {
                        const mb = v === "" ? 0 : parseInt(v, 10);
                        if (Number.isNaN(mb) || mb < 0) {
                          throw new Error("0 이상의 숫자 (0 = 무제한)");
                        }
                        await api.put(`/api/users/${u.id}`, { quota_mb: mb });
                        const newBytes = mb * 1024 * 1024;
                        setUsers((prev) =>
                          prev.map((x) => x.id === u.id ? { ...x, quota_bytes: newBytes } : x)
                        );
                      }}
                    />
                  )}
                </div>
              );
            },
          },
          {
            key: "actions", label: "작업", align: "center",
            render: (u) => (
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={() => handleResetPassword(u)}
                  title="비밀번호 초기화 (전화번호 있으면 전화번호로)"
                  className="p-1 hover:bg-bg-tertiary rounded text-text-tertiary hover:text-status-warning"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  onClick={() => setLifecycleTarget(u)}
                  title="인사이동 (전출·졸업·전학)"
                  className="p-1 hover:bg-bg-tertiary rounded text-text-tertiary hover:text-accent"
                >
                  <UserX size={14} />
                </button>
              </div>
            ),
          },
        ]}
        rows={users}
        keyExtractor={(u) => u.id}
        loading={loading}
        emptyText="사용자가 없습니다"
        page={page}
        totalPages={totalPages}
        totalCount={total}
        onPageChange={setPage}
      />

      {lifecycleTarget && (
        <LifecycleModal
          user={lifecycleTarget}
          allUsers={users}
          onClose={() => setLifecycleTarget(null)}
          onSaved={() => { setLifecycleTarget(null); fetchUsers(); }}
        />
      )}
    </div>
  );
}


