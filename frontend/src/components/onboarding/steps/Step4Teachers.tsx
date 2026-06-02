"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Trash2, Upload, Download, Save, FileSpreadsheet } from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface TeacherRow {
  name: string;
  email: string;
  phone: string;
  password: string; // 임시 비번 — 연락처 없을 때만 사용 (있으면 연락처가 초기 비번)
  department_id: number;
  is_grade_lead: boolean;
  lead_grade: number;
}

interface Department {
  id: number;
  name: string;
}

interface ExistingTeacher {
  id: number;
  name: string;
  email: string;
  department: string | null;
  department_id: number | null;
  is_grade_lead: boolean;
  lead_grade: number | null;
}

const emptyRow = (): TeacherRow => ({
  name: "",
  email: "",
  phone: "",
  password: "",
  department_id: 0,
  is_grade_lead: false,
  lead_grade: 0,
});

export function Step4Teachers() {
  const [rows, setRows] = useState<TeacherRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [existing, setExisting] = useState<ExistingTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, t] = await Promise.all([
        api.get<{ items: Department[] }>("/api/departments"),
        api.get<any>("/api/users?role=teacher,staff&limit=500"),
      ]);
      setDepartments(d.items);
      const list = Array.isArray(t) ? t : t.items || t.users || [];
      setExisting(list);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateRow = (i: number, patch: Partial<TeacherRow>) => {
    setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () => setRows([...rows, emptyRow()]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const submitAll = async () => {
    const valid = rows.filter((r) => r.name.trim() && r.email.trim());
    if (valid.length === 0) {
      alert("이름과 이메일을 입력한 줄이 없습니다");
      return;
    }
    const noPw = valid.filter((r) => !r.phone.trim() && !r.password.trim()).length;
    const warn = noPw > 0
      ? `\n\n⚠️ ${noPw}명은 연락처·임시비번이 모두 비어 공통 기본비번이 부여됩니다. 임시 비번 입력을 권장합니다.`
      : "";
    if (!confirm(`${valid.length}명의 교사를 등록하시겠습니까?\n초기 비밀번호 = 연락처(숫자만), 없으면 임시 비번.${warn}`)) return;
    setSaving(true);
    let ok = 0, fail = 0;
    const errors: string[] = [];
    for (const r of valid) {
      try {
        await api.post("/api/users", {
          name: r.name.trim(),
          email: r.email.trim(),
          role: "teacher",
          phone: r.phone.trim() || null,
          // 임시 비번 입력 시 그것을, 아니면 미전송 → 백엔드가 연락처(숫자만)를 초기 비번으로.
          password: r.password.trim() || undefined,
          department_id: r.department_id > 0 ? r.department_id : null,
          is_grade_lead: r.is_grade_lead,
          lead_grade: r.is_grade_lead && r.lead_grade > 0 ? r.lead_grade : null,
        });
        ok++;
      } catch (e: any) {
        fail++;
        errors.push(`${r.email}: ${e?.message || "실패"}`);
      }
    }
    setSaving(false);
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    await load();
    alert(`${ok}명 등록 완료${fail > 0 ? `\n실패 ${fail}건:\n${errors.slice(0, 5).join("\n")}` : ""}`);
  };

  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvUploading, setCsvUploading] = useState(false);

  const downloadTemplate = async () => {
    // backend의 한글 헤더 + 예시 + 설명 포함 템플릿 다운로드
    const token = localStorage.getItem("access_token");
    const res = await fetch(`${API_URL}/api/users/_csv/template/teacher`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      alert(`템플릿 다운로드 실패: ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "교사_등록_템플릿.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onCsvUpload = async (file: File) => {
    if (!file) return;
    if (!confirm(`'${file.name}' 으로 교사를 일괄 등록합니다. 계속할까요?\n(이미 등록된 이메일·아이디는 자동 skip)`)) {
      if (csvInputRef.current) csvInputRef.current.value = "";
      return;
    }
    setCsvUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/users/_csv/import/teacher`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      alert(`${data.ok_count}명 등록 완료${data.errors.length > 0 ? `\n실패 ${data.errors.length}건:\n${data.errors.slice(0, 5).map((e: any) => `행 ${e.row}: ${e.error}`).join("\n")}` : ""}`);
      await load();
    } catch (e: any) {
      alert(`업로드 실패: ${e.message || e}`);
    } finally {
      setCsvUploading(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-body font-semibold text-text-primary">교사 등록</h2>
          <p className="text-caption text-text-tertiary mt-1">
            줄별로 입력 또는 CSV 일괄 업로드.
            <br />초기 비밀번호 = <strong>연락처(숫자만)</strong>. 연락처가 없으면 <strong>임시 비번</strong>을 입력하세요. (첫 로그인 시 변경 강제)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="px-3 py-1.5 text-[12px] text-accent border border-accent/30 rounded hover:bg-accent/5 flex items-center gap-1"
          >
            <Download size={12} /> 템플릿
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => e.target.files?.[0] && onCsvUpload(e.target.files[0])}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            disabled={csvUploading}
            className="px-3 py-1.5 text-[12px] text-accent border border-accent/30 rounded hover:bg-accent/5 flex items-center gap-1 disabled:opacity-50"
          >
            <Upload size={12} /> {csvUploading ? "업로드 중..." : "엑셀 일괄 등록"}
          </button>
        </div>
      </div>

      {/* 줄별 입력 */}
      <div className="bg-bg-primary border border-border-default rounded-lg overflow-x-auto mb-3">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-secondary border-b border-border-default text-text-tertiary">
            <tr>
              <th className="px-2 py-2 text-left w-8"></th>
              <th className="px-2 py-2 text-left">이름 *</th>
              <th className="px-2 py-2 text-left">이메일 *</th>
              <th className="px-2 py-2 text-left">연락처</th>
              <th className="px-2 py-2 text-left w-28">임시 비번</th>
              <th className="px-2 py-2 text-left">부서</th>
              <th className="px-2 py-2 text-left w-24">학년부장</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border-default/30">
                <td className="px-2 py-1.5 text-text-tertiary text-center">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={r.name}
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                    placeholder="이름"
                    className="w-full px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="email"
                    value={r.email}
                    onChange={(e) => updateRow(i, { email: e.target.value })}
                    placeholder="email@school.kr"
                    className="w-full px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={r.phone}
                    onChange={(e) => updateRow(i, { phone: e.target.value })}
                    placeholder="010-..."
                    className="w-32 px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={r.password}
                    onChange={(e) => updateRow(i, { password: e.target.value })}
                    placeholder={r.phone.trim() ? "연락처 사용" : "연락처 없을 때"}
                    className="w-28 px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={r.department_id}
                    onChange={(e) => updateRow(i, { department_id: Number(e.target.value) })}
                    className="w-full px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                  >
                    <option value={0}>—</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={r.is_grade_lead ? r.lead_grade : 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateRow(i, { is_grade_lead: v > 0, lead_grade: v });
                    }}
                    className="w-full px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                  >
                    <option value={0}>—</option>
                    <option value={1}>1학년</option>
                    <option value={2}>2학년</option>
                    <option value={3}>3학년</option>
                  </select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="p-1 rounded hover:bg-red-50 text-red-500"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 border-t border-border-default flex items-center justify-between">
          <button
            type="button"
            onClick={addRow}
            className="text-[12px] text-accent hover:underline flex items-center gap-1"
          >
            <Plus size={12} /> 줄 추가
          </button>
          <button
            type="button"
            onClick={submitAll}
            disabled={saving || rows.every((r) => !r.name.trim())}
            className="px-4 py-1.5 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
          >
            <Save size={14} /> {saving ? "등록 중..." : "모두 등록"}
          </button>
        </div>
      </div>

      {/* 기존 등록된 교사 */}
      {!loading && existing.length > 0 && (
        <div className="bg-bg-secondary/30 border border-border-default rounded-lg p-3">
          <div className="text-[12px] text-text-secondary mb-2">
            현재 등록된 교사·직원 {existing.length}명
          </div>
          <div className="flex flex-wrap gap-1">
            {existing.slice(0, 30).map((t) => (
              <span key={t.id} className="px-2 py-0.5 bg-bg-primary border border-border-default rounded text-[11px]">
                {t.name}
                {t.department && <span className="text-text-tertiary"> · {t.department}</span>}
              </span>
            ))}
            {existing.length > 30 && (
              <span className="text-[11px] text-text-tertiary">+{existing.length - 30}명</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 마법사 후 <code className="text-accent">사용자 관리</code>에서 수정·삭제 가능합니다.
      </div>
    </div>
  );
}
