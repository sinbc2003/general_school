"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  MessageCircleQuestion,
  GraduationCap,
  Search,
} from "lucide-react";

type MainTab = "questions" | "records";

export default function AdmissionsPage() {
  const [tab, setTab] = useState<MainTab>("questions");

  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">진학 관리</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-bg-secondary rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("questions")}
          className={`flex items-center gap-1.5 px-4 py-2 text-body rounded transition-colors ${
            tab === "questions"
              ? "bg-bg-primary text-accent font-medium shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <MessageCircleQuestion size={16} /> 면접질문
        </button>
        <button
          onClick={() => setTab("records")}
          className={`flex items-center gap-1.5 px-4 py-2 text-body rounded transition-colors ${
            tab === "records"
              ? "bg-bg-primary text-accent font-medium shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <GraduationCap size={16} /> 진학기록
        </button>
      </div>

      {tab === "questions" && <QuestionsTab />}
      {tab === "records" && <RecordsTab />}
    </div>
  );
}

// ── Questions Tab ──
function QuestionsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    university: "", department: "", year: String(new Date().getFullYear()),
    category: "", question_text: "", model_answer: "",
  });

  const pageSize = 15;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      const data = await api.get(`/api/admissions/questions?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    try {
      await api.post("/api/admissions/questions", {
        ...form,
        year: Number(form.year),
      });
      setShowCreate(false);
      setForm({ university: "", department: "", year: String(new Date().getFullYear()), category: "", question_text: "", model_answer: "" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "등록 실패"); }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-body text-text-secondary">총 {total}건</span>
        <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1 px-4 py-2 bg-accent text-white text-body rounded hover:bg-accent-hover">
          <Plus size={16} /> 질문 등록
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 p-4 bg-bg-primary rounded-lg border border-border-default">
          <h3 className="text-body font-semibold text-text-primary mb-3">새 면접질문</h3>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input type="text" value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} placeholder="대학교" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="학과" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="년도" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="분류 (예: 전공, 인성)" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <textarea value={form.question_text} onChange={(e) => setForm({ ...form, question_text: e.target.value })} placeholder="질문 내용" rows={3} className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary resize-none mb-3" />
          <textarea value={form.model_answer} onChange={(e) => setForm({ ...form, model_answer: e.target.value })} placeholder="모범 답변 (선택)" rows={3} className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary resize-none mb-3" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">등록</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">대학교</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학과</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">년도</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">분류</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">질문</th>
            </tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id} className="border-t border-border-default hover:bg-bg-secondary">
                <td className="px-4 py-2 text-body text-text-primary whitespace-nowrap">{q.university}</td>
                <td className="px-4 py-2 text-body text-text-secondary whitespace-nowrap">{q.department}</td>
                <td className="px-4 py-2 text-body text-text-tertiary">{q.year}</td>
                <td className="px-4 py-2">
                  {q.category && (
                    <span className="inline-block px-2 py-0.5 text-caption rounded bg-blue-100 text-blue-700">{q.category}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-body text-text-primary max-w-md">
                  <div className="line-clamp-2">{q.question_text}</div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-body text-text-tertiary">{loading ? "로딩 중..." : "면접질문이 없습니다"}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <span className="text-caption text-text-secondary">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Records Tab ──
function RecordsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);

  const pageSize = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (year) params.set("year", year);
      const data = await api.get(`/api/admissions/records?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [page, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.ceil(total / pageSize);

  const RESULT_CONFIG: Record<string, { label: string; className: string }> = {
    accepted: { label: "합격", className: "bg-green-100 text-green-700" },
    rejected: { label: "불합격", className: "bg-red-100 text-red-700" },
    waitlisted: { label: "예비", className: "bg-yellow-100 text-yellow-700" },
    pending: { label: "대기", className: "bg-gray-100 text-gray-700" },
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <select value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary">
            <option value="">전체 년도</option>
            {[...Array(5)].map((_, i) => { const y = new Date().getFullYear() - i; return <option key={y} value={y}>{y}년</option>; })}
          </select>
          <span className="text-caption text-text-tertiary">총 {total}건</span>
        </div>
      </div>

      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학생</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">대학교</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학과</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">전형</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">년도</th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium">결과</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const result = RESULT_CONFIG[r.result] || { label: r.result, className: "bg-gray-100 text-gray-700" };
              return (
                <tr key={r.id} className="border-t border-border-default hover:bg-bg-secondary">
                  <td className="px-4 py-2 text-body text-text-primary">{r.student_name}</td>
                  <td className="px-4 py-2 text-body text-text-primary">{r.university}</td>
                  <td className="px-4 py-2 text-body text-text-secondary">{r.department}</td>
                  <td className="px-4 py-2 text-body text-text-secondary">{r.admission_type}</td>
                  <td className="px-4 py-2 text-body text-text-tertiary">{r.year}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 text-caption rounded ${result.className}`}>
                      {result.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-body text-text-tertiary">{loading ? "로딩 중..." : "진학기록이 없습니다"}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <span className="text-caption text-text-secondary">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
