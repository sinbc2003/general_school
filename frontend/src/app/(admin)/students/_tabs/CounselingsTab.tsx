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

export function CounselingsTab({ studentId }: { studentId: number }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ counseling_date: "", counseling_type: "individual", title: "", content: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/students/${studentId}/counselings`);
      setRecords(Array.isArray(data) ? data : []);
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    try {
      await api.post(`/api/students/${studentId}/counselings`, form);
      setShowForm(false);
      setForm({ counseling_date: "", counseling_type: "individual", title: "", content: "" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "등록 실패"); }
  };

  const TYPE_LABELS: Record<string, string> = {
    individual: "개인상담",
    group: "집단상담",
    academic: "학업상담",
    career: "진로상담",
    psychological: "심리상담",
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
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="제목" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary col-span-1" />
            <select value={form.counseling_type} onChange={(e) => setForm({ ...form, counseling_type: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary">
              <option value="individual">개인상담</option>
              <option value="group">집단상담</option>
              <option value="academic">학업상담</option>
              <option value="career">진로상담</option>
              <option value="psychological">심리상담</option>
            </select>
            <input type="date" value={form.counseling_date} onChange={(e) => setForm({ ...form, counseling_date: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="상담 내용" rows={4} className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary resize-none mb-3" />
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      <DataTable<any>
        columns={[
          { key: "counseling_date", label: "날짜", render: (r) => <span className="text-text-tertiary whitespace-nowrap">{r.counseling_date}</span> },
          {
            key: "counseling_type", label: "유형",
            render: (r) => (
              <span className="inline-block px-2 py-0.5 text-caption rounded bg-purple-100 text-purple-700">
                {TYPE_LABELS[r.counseling_type] || r.counseling_type}
              </span>
            ),
          },
          { key: "title", label: "제목" },
          { key: "content", label: "내용", render: (r) => <span className="text-text-secondary line-clamp-1 max-w-xs">{r.content}</span> },
        ]}
        rows={records}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyText="상담 기록이 없습니다"
      />
    </div>
  );
}

// ── Stats Tab (다년치 누적 통계) ──
