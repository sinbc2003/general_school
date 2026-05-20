"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Upload, Download, Save } from "lucide-react";
import { api } from "@/lib/api/client";

interface StudentRow {
  grade: number;
  class_number: number;
  student_number: number;
  name: string;
  email: string;
  phone: string;
}

const emptyRow = (): StudentRow => ({
  grade: 1, class_number: 1, student_number: 1,
  name: "", email: "", phone: "",
});

export function Step5Students() {
  const [rows, setRows] = useState<StudentRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [existingCount, setExistingCount] = useState(0);
  const [saving, setSaving] = useState(false);

  const loadCount = useCallback(async () => {
    try {
      const r = await api.get<any>("/api/users?role=student&limit=1");
      const list = Array.isArray(r) ? r : r.items || r.users || [];
      const total = r.total ?? r.count ?? list.length;
      setExistingCount(total);
    } catch {}
  }, []);

  useEffect(() => { loadCount(); }, [loadCount]);

  const updateRow = (i: number, patch: Partial<StudentRow>) => {
    setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () => {
    const last = rows[rows.length - 1];
    setRows([...rows, { ...emptyRow(), grade: last?.grade || 1, class_number: last?.class_number || 1, student_number: (last?.student_number || 0) + 1 }]);
  };
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const submitAll = async () => {
    const valid = rows.filter((r) => r.name.trim() && r.email.trim());
    if (valid.length === 0) { alert("이름과 이메일 입력한 줄이 없습니다"); return; }
    if (!confirm(`${valid.length}명의 학생을 등록하시겠습니까?`)) return;
    setSaving(true);
    let ok = 0, fail = 0;
    const errors: string[] = [];
    for (const r of valid) {
      try {
        await api.post("/api/users", {
          name: r.name.trim(),
          email: r.email.trim(),
          role: "student",
          phone: r.phone.trim() || null,
          password: r.phone.replace(/-/g, "") || undefined,
          grade: r.grade,
          class_number: r.class_number,
          student_number: r.student_number,
        });
        ok++;
      } catch (e: any) { fail++; errors.push(`${r.email}: ${e?.message || "실패"}`); }
    }
    setSaving(false);
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    await loadCount();
    alert(`${ok}명 등록 완료${fail > 0 ? `\n실패 ${fail}건:\n${errors.slice(0, 5).join("\n")}` : ""}`);
  };

  const downloadTemplate = () => {
    const csv = "grade,class_number,student_number,name,email,phone\n1,1,1,홍길동,hong@school.kr,010-1111-2222\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "students_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-body font-semibold text-text-primary">학생 등록</h2>
          <p className="text-caption text-text-tertiary mt-1">
            줄별 입력 또는 CSV 일괄 업로드. 학년/반/번호 필수.
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
          <a
            href="/users/import"
            target="_blank"
            className="px-3 py-1.5 text-[12px] text-accent border border-accent/30 rounded hover:bg-accent/5 flex items-center gap-1"
          >
            <Upload size={12} /> CSV 업로드
          </a>
        </div>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg overflow-x-auto mb-3">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-secondary border-b border-border-default text-text-tertiary">
            <tr>
              <th className="px-2 py-2 text-left w-8"></th>
              <th className="px-2 py-2 text-left w-14">학년</th>
              <th className="px-2 py-2 text-left w-14">반</th>
              <th className="px-2 py-2 text-left w-14">번호</th>
              <th className="px-2 py-2 text-left">이름 *</th>
              <th className="px-2 py-2 text-left">이메일 *</th>
              <th className="px-2 py-2 text-left">연락처</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border-default/30">
                <td className="px-2 py-1.5 text-text-tertiary text-center">{i + 1}</td>
                <td><input type="number" value={r.grade} min={1} max={6} onChange={(e) => updateRow(i, { grade: Number(e.target.value) })} className="w-12 px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary" /></td>
                <td><input type="number" value={r.class_number} min={1} onChange={(e) => updateRow(i, { class_number: Number(e.target.value) })} className="w-12 px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary" /></td>
                <td><input type="number" value={r.student_number} min={1} onChange={(e) => updateRow(i, { student_number: Number(e.target.value) })} className="w-14 px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary" /></td>
                <td className="px-2 py-1.5"><input type="text" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="이름" className="w-full px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary" /></td>
                <td className="px-2 py-1.5"><input type="email" value={r.email} onChange={(e) => updateRow(i, { email: e.target.value })} placeholder="email" className="w-full px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary" /></td>
                <td className="px-2 py-1.5"><input type="text" value={r.phone} onChange={(e) => updateRow(i, { phone: e.target.value })} placeholder="010-..." className="w-32 px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary" /></td>
                <td className="px-2 py-1.5 text-center"><button type="button" onClick={() => removeRow(i)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 border-t border-border-default flex items-center justify-between">
          <button type="button" onClick={addRow} className="text-[12px] text-accent hover:underline flex items-center gap-1">
            <Plus size={12} /> 줄 추가
          </button>
          <button type="button" onClick={submitAll} disabled={saving || rows.every((r) => !r.name.trim())} className="px-4 py-1.5 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1">
            <Save size={14} /> {saving ? "등록 중..." : "모두 등록"}
          </button>
        </div>
      </div>

      <div className="bg-bg-secondary/30 border border-border-default rounded-lg p-3">
        <div className="text-[12px] text-text-secondary">현재 등록된 학생: <strong className="text-text-primary">{existingCount}명</strong></div>
      </div>

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 학생 수가 많으면 [CSV 업로드 페이지]에서 한꺼번에 등록하는 것을 권장합니다.
      </div>
    </div>
  );
}
