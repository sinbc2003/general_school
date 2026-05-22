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

export function RecordsTab({ studentId }: { studentId: number }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    year: String(new Date().getFullYear()), semester: "1",
    record_type: "behavior", content: "",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/students/${studentId}/records`);
      setRecords(Array.isArray(data) ? data : (data?.items ?? []));
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }, [studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    try {
      await api.post(`/api/students/${studentId}/records`, {
        ...form, year: Number(form.year), semester: Number(form.semester),
      });
      setShowForm(false);
      setForm({ year: String(new Date().getFullYear()), semester: "1", record_type: "behavior", content: "" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "등록 실패"); }
  };

  const TYPE_LABELS: Record<string, string> = {
    behavior: "행동특성 및 종합의견",
    autonomous: "자율활동",
    club_activity: "동아리활동",
    volunteer: "봉사활동",
    career: "진로활동",
    reading: "독서활동",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-body text-text-secondary">{records.length}건</span>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-caption rounded">
          <Plus size={14} /> 추가
        </button>
      </div>
      {showForm && (
        <div className="mb-4 p-4 bg-bg-primary rounded-lg border border-border-default">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}
                   placeholder="년도" className="px-3 py-2 text-body border border-border-default rounded" />
            <select value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })}
                    className="px-3 py-2 text-body border border-border-default rounded">
              <option value="1">1학기</option><option value="2">2학기</option>
            </select>
            <select value={form.record_type} onChange={(e) => setForm({ ...form, record_type: e.target.value })}
                    className="px-3 py-2 text-body border border-border-default rounded">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder="기록 내용" rows={6} className="w-full px-3 py-2 text-body border border-border-default rounded mb-3" />
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="px-4 py-1.5 bg-accent text-white text-body rounded">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 border border-border-default text-body rounded">취소</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {records.map((r) => (
          <div key={r.id} className="bg-bg-primary border border-border-default rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption px-2 py-0.5 bg-accent-light text-accent rounded">{TYPE_LABELS[r.record_type] || r.record_type}</span>
              <span className="text-caption text-text-tertiary">{r.year}년 {r.semester}학기</span>
            </div>
            <div className="text-body text-text-primary whitespace-pre-wrap">{r.content}</div>
          </div>
        ))}
        {records.length === 0 && (
          <div className="text-center py-8 text-text-tertiary">{loading ? "로딩 중..." : "생기부 기록이 없습니다"}</div>
        )}
      </div>
    </div>
  );
}


// ── Mock Exams Tab ──
