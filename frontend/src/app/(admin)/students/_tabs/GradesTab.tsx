"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus, X, Award, FileText, MessageSquare, BarChart3, BookOpen,
  Notebook, Briefcase, Target, Eye, Globe, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { downloadSecure } from "@/lib/api/download";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export function GradesTab({ studentId }: { studentId: number }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [semester, setSemester] = useState("");
  const [form, setForm] = useState({ year: String(new Date().getFullYear()), semester: "1", exam_type: "midterm", subject: "", score: "", max_score: "100", grade_rank: "", class_rank: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (semester) params.set("semester", semester);
      const data = await api.get(`/api/students/${studentId}/grades?${params}`);
      setRecords(Array.isArray(data) ? data : []);
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [studentId, year, semester]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    try {
      await api.post(`/api/students/${studentId}/grades`, {
        ...form,
        year: Number(form.year),
        semester: Number(form.semester),
        score: Number(form.score),
        max_score: Number(form.max_score),
        grade_rank: form.grade_rank ? Number(form.grade_rank) : null,
        class_rank: form.class_rank ? Number(form.class_rank) : null,
      });
      setShowForm(false);
      setForm({ year: String(new Date().getFullYear()), semester: "1", exam_type: "midterm", subject: "", score: "", max_score: "100", grade_rank: "", class_rank: "" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "등록 실패"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(e.target.value)} className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary">
            {[...Array(5)].map((_, i) => { const y = new Date().getFullYear() - i; return <option key={y} value={y}>{y}년</option>; })}
          </select>
          <select value={semester} onChange={(e) => setSemester(e.target.value)} className="px-2 py-1 text-caption border border-border-default rounded bg-bg-primary">
            <option value="">전체 학기</option>
            <option value="1">1학기</option>
            <option value="2">2학기</option>
          </select>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-caption rounded hover:bg-accent-hover">
          <Plus size={14} /> 추가
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-bg-primary rounded-lg border border-border-default">
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input type="text" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="년도" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <select value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary">
              <option value="1">1학기</option>
              <option value="2">2학기</option>
            </select>
            <select value={form.exam_type} onChange={(e) => setForm({ ...form, exam_type: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary">
              <option value="midterm">중간고사</option>
              <option value="final">기말고사</option>
            </select>
            <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="과목" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input type="number" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} placeholder="점수" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="number" value={form.max_score} onChange={(e) => setForm({ ...form, max_score: e.target.value })} placeholder="만점" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="number" value={form.grade_rank} onChange={(e) => setForm({ ...form, grade_rank: e.target.value })} placeholder="학년 석차" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="number" value={form.class_rank} onChange={(e) => setForm({ ...form, class_rank: e.target.value })} placeholder="반 석차" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      <DataTable<any>
        columns={[
          { key: "period", label: "년도/학기", render: (r) => `${r.year}-${r.semester}학기` },
          { key: "exam_type", label: "시험", render: (r) => (r.exam_type === "midterm" ? "중간" : "기말") },
          { key: "subject", label: "과목" },
          { key: "score", label: "점수", align: "right", render: (r) => `${r.score}/${r.max_score}` },
          { key: "grade_rank", label: "학년석차", align: "right", render: (r) => r.grade_rank || "-" },
          { key: "class_rank", label: "반석차", align: "right", render: (r) => r.class_rank || "-" },
        ]}
        rows={records}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyText="성적 기록이 없습니다"
      />
    </div>
  );
}

// ── Awards Tab ──
