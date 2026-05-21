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

export function ThesesTab({ studentId }: { studentId: number }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", thesis_type: "", abstract: "", status: "draft" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/students/${studentId}/theses`);
      setRecords(Array.isArray(data) ? data : []);
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    try {
      await api.post(`/api/students/${studentId}/theses`, form);
      setShowForm(false);
      setForm({ title: "", thesis_type: "", abstract: "", status: "draft" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "등록 실패"); }
  };

  const STATUS_LABELS: Record<string, { label: string; className: string }> = {
    draft: { label: "초안", className: "bg-gray-100 text-gray-700" },
    in_review: { label: "심사중", className: "bg-cream-200 text-blue-700" },
    published: { label: "출판", className: "bg-green-100 text-green-700" },
    rejected: { label: "반려", className: "bg-red-100 text-red-700" },
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
          <div className="space-y-3 mb-3">
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="논문 제목" className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={form.thesis_type} onChange={(e) => setForm({ ...form, thesis_type: e.target.value })} placeholder="유형 (예: R&E, 졸업논문)" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary">
                <option value="draft">초안</option>
                <option value="in_review">심사중</option>
                <option value="published">출판</option>
              </select>
            </div>
            <textarea value={form.abstract} onChange={(e) => setForm({ ...form, abstract: e.target.value })} placeholder="초록" rows={3} className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      <DataTable<any>
        columns={[
          {
            key: "title", label: "제목",
            render: (r) => (
              <>
                <div className="text-text-primary">{r.title}</div>
                {r.abstract && <div className="text-caption text-text-tertiary mt-0.5 line-clamp-1">{r.abstract}</div>}
              </>
            ),
          },
          { key: "thesis_type", label: "유형", render: (r) => <span className="text-text-secondary">{r.thesis_type}</span> },
          {
            key: "status", label: "상태",
            render: (r) => (
              <span className={`inline-block px-2 py-0.5 text-caption rounded ${STATUS_LABELS[r.status]?.className || "bg-gray-100 text-gray-700"}`}>
                {STATUS_LABELS[r.status]?.label || r.status}
              </span>
            ),
          },
        ]}
        rows={records}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyText="논문 기록이 없습니다"
      />
    </div>
  );
}

// ── Counselings Tab ──
