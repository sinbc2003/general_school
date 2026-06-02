"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

const BASE_ROLES = [
  { value: "student", label: "학생" },
  { value: "teacher", label: "교사" },
  { value: "staff", label: "직원" },
];

export function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { isSuperAdmin } = useAuth();
  const [role, setRole] = useState("student");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [grade, setGrade] = useState("");
  const [classNumber, setClassNumber] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [department, setDepartment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const roles = isSuperAdmin
    ? [...BASE_ROLES, { value: "designated_admin", label: "지정관리자" }]
    : BASE_ROLES;
  const isStudent = role === "student";
  const input =
    "w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent";

  const submit = async () => {
    setError("");
    if (!name.trim() || !email.trim()) {
      setError("이름과 이메일은 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        username: username.trim() || undefined,
        role,
        phone: phone.trim() || null,
        password: password.trim() || undefined,
      };
      if (isStudent) {
        body.grade = grade ? Number(grade) : null;
        body.class_number = classNumber ? Number(classNumber) : null;
        body.student_number = studentNumber ? Number(studentNumber) : null;
      } else {
        body.department = department.trim() || null;
      }
      await api.post("/api/users", body);
      const initPw = password.trim() || phone.replace(/\D/g, "") || "공통 기본비번";
      alert(`${name} 계정 등록 완료.\n초기 비밀번호: ${initPw}\n(사용자는 첫 로그인 시 변경)`);
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e?.detail || e?.message || "등록 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default sticky top-0 bg-bg-primary">
          <h2 className="text-body font-semibold text-text-primary">개별 계정 등록</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-caption text-text-secondary">역할</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-caption text-text-secondary">이름 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="홍길동" />
          </div>
          <div>
            <label className="text-caption text-text-secondary">이메일 *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="user@school.kr" />
          </div>
          <div>
            <label className="text-caption text-text-secondary">아이디 (선택 — 로그인 시 이메일 대신 사용 가능)</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className={input} placeholder={isStudent ? "학번 등" : "영문/숫자"} />
          </div>

          {isStudent ? (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-caption text-text-secondary">학년</label>
                <input type="number" value={grade} onChange={(e) => setGrade(e.target.value)} className={input} />
              </div>
              <div>
                <label className="text-caption text-text-secondary">반</label>
                <input type="number" value={classNumber} onChange={(e) => setClassNumber(e.target.value)} className={input} />
              </div>
              <div>
                <label className="text-caption text-text-secondary">번호</label>
                <input type="number" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} className={input} />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-caption text-text-secondary">부서</label>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} className={input} placeholder="예: 수학과" />
            </div>
          )}

          <div>
            <label className="text-caption text-text-secondary">연락처 (초기 비밀번호로 사용 — '-' 없이)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="01012345678" />
          </div>
          <div>
            <label className="text-caption text-text-secondary">임시 비밀번호 (연락처 없을 때만)</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} className={input} placeholder="비우면 연락처 또는 공통 기본비번" />
          </div>

          {error && <div className="text-caption text-status-error">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default sticky bottom-0 bg-bg-primary">
          <button onClick={onClose} className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary">
            취소
          </button>
          <button onClick={submit} disabled={saving} className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50">
            {saving ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
