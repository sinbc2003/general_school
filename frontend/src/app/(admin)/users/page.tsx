"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { PermissionGate } from "@/components/common/permission-gate";
import {
  Upload,
  Download,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";

interface UserItem {
  id: number;
  email: string;
  name: string;
  username: string | null;
  role: string;
  status: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  department: string | null;
  created_at: string | null;
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
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/users/excel-template`,
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

  const handleResetPassword = async (userId: number) => {
    if (!confirm("비밀번호를 초기화하시겠습니까?")) return;
    try {
      const result = await api.post(`/api/users/${userId}/reset-password`);
      alert(`초기화 완료. 기본 비밀번호: ${result.default_password}`);
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
          <PermissionGate permission="user.manage.bulk_import">
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
            >
              <Download size={14} />
              템플릿
            </button>
            <label className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded cursor-pointer hover:bg-accent-hover">
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

      {/* 테이블 */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">이름</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">이메일</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">역할</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">상태</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학년/반/번호</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">부서</th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border-default hover:bg-bg-secondary">
                <td className="px-4 py-2 text-body text-text-primary">{u.name}</td>
                <td className="px-4 py-2 text-body text-text-secondary">{u.email}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block px-2 py-0.5 text-caption rounded ${
                    u.role === "super_admin" ? "bg-red-100 text-red-700" :
                    u.role === "designated_admin" ? "bg-purple-100 text-purple-700" :
                    u.role === "teacher" ? "bg-blue-100 text-blue-700" :
                    u.role === "staff" ? "bg-green-100 text-green-700" :
                    "bg-gray-100 text-gray-700"
                  }`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-caption ${u.status === "approved" ? "text-status-success" : "text-status-error"}`}>
                    {STATUS_LABELS[u.status] || u.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {u.grade ? `${u.grade}-${u.class_number || "?"}-${u.student_number || "?"}` : "-"}
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">{u.department || "-"}</td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={() => handleResetPassword(u.id)}
                    title="비밀번호 초기화"
                    className="p-1 hover:bg-bg-tertiary rounded text-text-tertiary hover:text-status-warning"
                  >
                    <RotateCcw size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : "사용자가 없습니다"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages} ({total}명)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
