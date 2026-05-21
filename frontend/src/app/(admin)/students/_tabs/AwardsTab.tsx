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

export function AwardsTab({ studentId }: { studentId: number }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", award_type: "", category: "", award_level: "", award_date: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/students/${studentId}/awards`);
      setRecords(Array.isArray(data) ? data : []);
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    try {
      await api.post(`/api/students/${studentId}/awards`, form);
      setShowForm(false);
      setForm({ title: "", award_type: "", category: "", award_level: "", award_date: "" });
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
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="수상명" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary col-span-2" />
            <input type="date" value={form.award_date} onChange={(e) => setForm({ ...form, award_date: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input type="text" value={form.award_type} onChange={(e) => setForm({ ...form, award_type: e.target.value })} placeholder="수상유형 (예: 교내, 교외)" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="분야" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.award_level} onChange={(e) => setForm({ ...form, award_level: e.target.value })} placeholder="수상등급 (예: 금상)" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      <DataTable<any>
        columns={[
          { key: "title", label: "수상명" },
          { key: "award_type", label: "유형", render: (r) => <span className="text-text-secondary">{r.award_type}</span> },
          { key: "category", label: "분야", render: (r) => <span className="text-text-secondary">{r.category}</span> },
          {
            key: "award_level", label: "등급",
            render: (r) => <span className="inline-block px-2 py-0.5 text-caption rounded bg-yellow-100 text-yellow-700">{r.award_level}</span>,
          },
          { key: "award_date", label: "수상일", render: (r) => <span className="text-text-tertiary">{r.award_date}</span> },
        ]}
        rows={records}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyText="수상 기록이 없습니다"
      />
    </div>
  );
}

// ── Theses Tab ──
