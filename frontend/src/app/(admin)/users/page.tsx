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
  RotateCcw,
  FileText,
  X,
  AlertCircle,
} from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { InlineCell } from "@/components/ui/InlineCell";

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
  const [showCsvModal, setShowCsvModal] = useState(false);

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
          {isSuperAdmin && (
            <button
              onClick={() => setShowCsvModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
            >
              <Upload size={14} />
              CSV 일괄 등록
            </button>
          )}
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
        columns={[
          { key: "name", label: "이름" },
          { key: "email", label: "이메일", render: (u) => <span className="text-text-secondary">{u.email}</span> },
          {
            key: "role", label: "역할",
            render: (u) => (
              <span className={`inline-block px-2 py-0.5 text-caption rounded ${
                u.role === "super_admin" ? "bg-red-100 text-red-700" :
                u.role === "designated_admin" ? "bg-purple-100 text-purple-700" :
                u.role === "teacher" ? "bg-blue-100 text-blue-700" :
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
            key: "actions", label: "작업", align: "center",
            render: (u) => (
              <button
                onClick={() => handleResetPassword(u.id)}
                title="비밀번호 초기화"
                className="p-1 hover:bg-bg-tertiary rounded text-text-tertiary hover:text-status-warning"
              >
                <RotateCcw size={14} />
              </button>
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
    </div>
  );
}


// ── CSV 일괄 등록 모달 ──
function CsvBulkImportModal({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<"designated_admin" | "teacher" | "student">("student");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const ROLE_INFO: Record<string, { label: string; desc: string; cols: string }> = {
    designated_admin: {
      label: "지정관리자",
      desc: "권한 관리·사용자 등록 등 super_admin과 거의 동일한 권한",
      cols: "name, email, username, password",
    },
    teacher: {
      label: "교사",
      desc: "수업·학생 지도용. 학생 데이터 조회 가능",
      cols: "name, email, username, password, department",
    },
    student: {
      label: "학생",
      desc: "본인 포트폴리오·진로·챗봇 사용",
      cols: "name, email, username, password, grade, class_number, student_number",
    },
  };

  const downloadTemplate = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/users/_csv/template/${role}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      alert("템플릿 다운로드 실패");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `users_${role}_template.csv`;
    a.click();
  };

  const upload = async (dryRun: boolean) => {
    if (!file) return alert("CSV 파일을 선택하세요");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.fetch<any>(`/api/users/_csv/import/${role}?dry_run=${dryRun}`, {
        method: "POST",
        body: fd,
      });
      setResult(r);
    } catch (e: any) {
      alert(e?.detail || "업로드 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold text-text-primary">CSV 일괄 등록 (최고관리자 전용)</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-body font-medium text-text-primary mb-2">역할 선택</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(Object.keys(ROLE_INFO) as Array<keyof typeof ROLE_INFO>).map((r) => (
                <button
                  key={r}
                  onClick={() => { setRole(r); setResult(null); setFile(null); }}
                  className={`text-left p-3 border rounded-lg ${role === r ? "border-accent bg-accent-light" : "border-border-default hover:bg-bg-secondary"}`}
                >
                  <div className="text-body font-medium">{ROLE_INFO[r].label}</div>
                  <div className="text-caption text-text-tertiary mt-0.5">{ROLE_INFO[r].desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-bg-secondary rounded p-3">
            <div className="text-caption text-text-secondary mb-1">CSV 컬럼 (헤더 첫 줄):</div>
            <code className="text-caption text-text-primary">{ROLE_INFO[role].cols}</code>
            <div className="text-caption text-text-tertiary mt-2">
              · 필수: name, email, username
              <br />· password 미입력 시 기본값 사용 + 첫 로그인 시 변경 강제
              <br />· UTF-8 (Excel에서 저장 시 "CSV UTF-8" 선택)
            </div>
          </div>

          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1 px-3 py-1.5 border border-border-default rounded text-body hover:bg-bg-secondary"
          >
            <FileText size={14} /> {ROLE_INFO[role].label} 템플릿 다운로드 (예시 1행 포함)
          </button>

          <div>
            <label className="block text-body font-medium text-text-primary mb-1">CSV 파일</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
              className="block w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => upload(true)}
              disabled={!file || busy}
              className="flex-1 px-4 py-2 border border-border-default rounded text-body disabled:opacity-50"
            >
              검증만 (dry-run)
            </button>
            <button
              onClick={() => upload(false)}
              disabled={!file || busy}
              className="flex-1 flex items-center justify-center gap-1 px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50"
            >
              <Upload size={14} /> 업로드 실행
            </button>
          </div>

          {result && (
            <div className="bg-bg-secondary rounded p-3 mt-2">
              <div className="flex items-center gap-2 mb-2">
                {result.errors?.length === 0
                  ? <span className="text-status-success font-medium">✓ {result.dry_run ? "검증 성공" : "등록 완료"}</span>
                  : <AlertCircle size={16} className="text-status-warning" />}
                <span className="text-body">
                  성공 <strong>{result.ok_count}</strong>건 · 실패 <strong>{result.errors?.length || 0}</strong>건
                </span>
              </div>
              {result.errors?.length > 0 && (
                <div className="max-h-48 overflow-y-auto text-caption space-y-0.5">
                  {result.errors.slice(0, 80).map((e: any, i: number) => (
                    <div key={i}>
                      <span className="text-text-tertiary">행 {e.row}:</span> {e.error}
                    </div>
                  ))}
                  {result.errors.length > 80 && (
                    <div className="text-text-tertiary">... 외 {result.errors.length - 80}건</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
