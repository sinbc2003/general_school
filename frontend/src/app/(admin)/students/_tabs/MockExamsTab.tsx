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

export function MockExamsTab({ studentId }: { studentId: number }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ exam_name: "", exam_date: "", subject: "", raw_score: "", standard_score: "", percentile: "", grade_level: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/students/${studentId}/mock-exams`);
      setRecords(Array.isArray(data) ? data : (data?.items ?? []));
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    try {
      await api.post(`/api/students/${studentId}/mock-exams`, {
        ...form,
        raw_score: form.raw_score ? Number(form.raw_score) : null,
        standard_score: form.standard_score ? Number(form.standard_score) : null,
        percentile: form.percentile ? Number(form.percentile) : null,
        grade_level: form.grade_level ? Number(form.grade_level) : null,
      });
      setShowForm(false);
      setForm({ exam_name: "", exam_date: "", subject: "", raw_score: "", standard_score: "", percentile: "", grade_level: "" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "등록 실패"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-body text-text-secondary">{records.length}건</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-caption rounded hover:bg-accent-hover">
          <Plus size={14} /> 추가
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-bg-primary rounded-lg border border-border-default">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input type="text" value={form.exam_name} onChange={(e) => setForm({ ...form, exam_name: e.target.value })} placeholder="시험명 (예: 6월 모의고사)" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="date" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="과목" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input type="number" value={form.raw_score} onChange={(e) => setForm({ ...form, raw_score: e.target.value })} placeholder="원점수" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="number" value={form.standard_score} onChange={(e) => setForm({ ...form, standard_score: e.target.value })} placeholder="표준점수" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="number" value={form.percentile} onChange={(e) => setForm({ ...form, percentile: e.target.value })} placeholder="백분위" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="number" value={form.grade_level} onChange={(e) => setForm({ ...form, grade_level: e.target.value })} placeholder="등급" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      <DataTable<any>
        columns={[
          { key: "exam_name", label: "시험명" },
          { key: "exam_date", label: "날짜", render: (r) => <span className="text-text-tertiary">{r.exam_date}</span> },
          { key: "subject", label: "과목" },
          { key: "raw_score", label: "원점수", align: "right", render: (r) => r.raw_score ?? "-" },
          { key: "standard_score", label: "표준점수", align: "right", render: (r) => r.standard_score ?? "-" },
          { key: "percentile", label: "백분위", align: "right", render: (r) => r.percentile ?? "-" },
          {
            key: "grade_level", label: "등급", align: "right",
            render: (r) => r.grade_level ? (
              <span className={`inline-block px-2 py-0.5 text-caption rounded font-medium ${
                r.grade_level <= 2 ? "bg-green-100 text-green-700" :
                r.grade_level <= 4 ? "bg-cream-200 text-blue-700" :
                r.grade_level <= 6 ? "bg-yellow-100 text-yellow-700" :
                "bg-red-100 text-red-700"
              }`}>{r.grade_level}등급</span>
            ) : <span className="text-text-tertiary">-</span>,
          },
        ]}
        rows={records}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyText="모의고사 기록이 없습니다"
      />
    </div>
  );
}

// ── Artifacts Tab (학생 본인 산출물 — 교사 조회) ──
