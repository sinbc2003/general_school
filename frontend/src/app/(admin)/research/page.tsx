"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  ClipboardList,
  Calendar,
  Users,
} from "lucide-react";

interface ResearchItem {
  id: number;
  title: string;
  research_type: string;
  status: string;
  year: number;
  members: string[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  planning: { label: "계획", className: "bg-gray-100 text-gray-700" },
  in_progress: { label: "진행중", className: "bg-blue-100 text-blue-700" },
  completed: { label: "완료", className: "bg-green-100 text-green-700" },
  cancelled: { label: "취소", className: "bg-red-100 text-red-700" },
};

export default function ResearchPage() {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: "", research_type: "R&E", description: "", advisor_id: "",
    members: "", year: String(new Date().getFullYear()), semester: "1",
  });

  const pageSize = 15;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (year) params.set("year", year);
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get(`/api/research?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, year, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    try {
      await api.post("/api/research", {
        ...form,
        advisor_id: form.advisor_id ? Number(form.advisor_id) : null,
        members: form.members ? form.members.split(",").map((m) => m.trim()) : [],
        year: Number(form.year),
        semester: Number(form.semester),
      });
      setShowCreate(false);
      setForm({ title: "", research_type: "R&E", description: "", advisor_id: "", members: "", year: String(new Date().getFullYear()), semester: "1" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "생성 실패"); }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">연구 프로젝트</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-4 py-2 bg-accent text-white text-body rounded hover:bg-accent-hover"
        >
          <Plus size={16} /> 프로젝트 생성
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 p-4 bg-bg-primary rounded-lg border border-border-default">
          <h3 className="text-body font-semibold text-text-primary mb-3">새 연구 프로젝트</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="프로젝트 제목" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary col-span-2" />
            <select value={form.research_type} onChange={(e) => setForm({ ...form, research_type: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary">
              <option value="R&E">R&E</option>
              <option value="individual">개인연구</option>
              <option value="group">공동연구</option>
              <option value="thesis">졸업논문</option>
            </select>
          </div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="연구 설명" rows={3} className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary resize-none mb-3" />
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input type="text" value={form.advisor_id} onChange={(e) => setForm({ ...form, advisor_id: e.target.value })} placeholder="지도교사 ID" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value })} placeholder="참여자 (쉼표 구분)" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <input type="text" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="년도" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <select value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary">
              <option value="1">1학기</option>
              <option value="2">2학기</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">생성</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary">
          {[...Array(5)].map((_, i) => { const y = new Date().getFullYear() - i; return <option key={y} value={y}>{y}년</option>; })}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary">
          <option value="">전체 상태</option>
          <option value="planning">계획</option>
          <option value="in_progress">진행중</option>
          <option value="completed">완료</option>
          <option value="cancelled">취소</option>
        </select>
        <span className="text-caption text-text-tertiary ml-auto">총 {total}건</span>
      </div>

      {/* List */}
      <div className="space-y-2">
        {items.map((item) => (
          <ResearchRow
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
          />
        ))}
        {items.length === 0 && (
          <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center text-body text-text-tertiary">
            {loading ? "로딩 중..." : "연구 프로젝트가 없습니다"}
          </div>
        )}
      </div>

      {/* Pagination */}
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

// ── Expandable Research Row ──
function ResearchRow({ item, expanded, onToggle }: { item: ResearchItem; expanded: boolean; onToggle: () => void }) {
  const status = STATUS_CONFIG[item.status] || { label: item.status, className: "bg-gray-100 text-gray-700" };

  return (
    <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-secondary transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronUp size={16} className="text-text-tertiary" /> : <ChevronDown size={16} className="text-text-tertiary" />}
          <div className="text-left">
            <div className="text-body text-text-primary font-medium">{item.title}</div>
            <div className="text-caption text-text-tertiary flex items-center gap-2 mt-0.5">
              <span>{item.research_type}</span>
              <span>|</span>
              <span>{item.year}년</span>
              {item.members?.length > 0 && (
                <>
                  <span>|</span>
                  <span className="flex items-center gap-1"><Users size={12} /> {item.members.length}명</span>
                </>
              )}
            </div>
          </div>
        </div>
        <span className={`inline-block px-2 py-0.5 text-caption rounded ${status.className}`}>
          {status.label}
        </span>
      </button>

      {expanded && <ResearchDetail researchId={item.id} />}
    </div>
  );
}

// ── Research Detail (Logs + Submissions) ──
function ResearchDetail({ researchId }: { researchId: number }) {
  const [tab, setTab] = useState<"logs" | "submissions">("logs");
  const [logs, setLogs] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingSubs, setLoadingSubs] = useState(true);

  useEffect(() => {
    api.get(`/api/research/${researchId}/logs`).then((d) => setLogs(Array.isArray(d) ? d : [])).catch(() => setLogs([])).finally(() => setLoadingLogs(false));
    api.get(`/api/research/${researchId}/submissions`).then((d) => setSubmissions(Array.isArray(d) ? d : [])).catch(() => setSubmissions([])).finally(() => setLoadingSubs(false));
  }, [researchId]);

  return (
    <div className="border-t border-border-default px-4 py-3">
      <div className="flex gap-1 mb-3 bg-bg-secondary rounded p-0.5 w-fit">
        <button
          onClick={() => setTab("logs")}
          className={`flex items-center gap-1 px-3 py-1.5 text-caption rounded ${tab === "logs" ? "bg-bg-primary text-accent font-medium shadow-sm" : "text-text-secondary"}`}
        >
          <ClipboardList size={14} /> 연구일지 ({logs.length})
        </button>
        <button
          onClick={() => setTab("submissions")}
          className={`flex items-center gap-1 px-3 py-1.5 text-caption rounded ${tab === "submissions" ? "bg-bg-primary text-accent font-medium shadow-sm" : "text-text-secondary"}`}
        >
          <FileText size={14} /> 제출물 ({submissions.length})
        </button>
      </div>

      {tab === "logs" && (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="p-3 bg-bg-secondary rounded">
              <div className="flex items-center justify-between mb-1">
                <span className="text-body text-text-primary font-medium">{log.title}</span>
                <span className="text-caption text-text-tertiary">{log.created_at?.slice(0, 10)}</span>
              </div>
              <div className="text-caption text-text-secondary line-clamp-2">{log.content}</div>
              {log.feedback && (
                <div className="mt-1 text-caption text-accent">피드백: {log.feedback}</div>
              )}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-center py-4 text-caption text-text-tertiary">
              {loadingLogs ? "로딩 중..." : "연구일지가 없습니다"}
            </div>
          )}
        </div>
      )}

      {tab === "submissions" && (
        <div className="space-y-2">
          {submissions.map((sub) => (
            <div key={sub.id} className="flex items-center justify-between p-3 bg-bg-secondary rounded">
              <div>
                <div className="text-body text-text-primary">{sub.title}</div>
                <div className="text-caption text-text-tertiary">
                  {sub.submission_type} | {sub.filename} ({sub.file_size ? `${(sub.file_size / 1024).toFixed(0)}KB` : "-"})
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-caption rounded ${
                  sub.review_status === "approved" ? "bg-green-100 text-green-700" :
                  sub.review_status === "rejected" ? "bg-red-100 text-red-700" :
                  "bg-yellow-100 text-yellow-700"
                }`}>
                  {sub.review_status === "approved" ? "승인" : sub.review_status === "rejected" ? "반려" : "대기"}
                </span>
                <span className="text-caption text-text-tertiary">{sub.created_at?.slice(0, 10)}</span>
              </div>
            </div>
          ))}
          {submissions.length === 0 && (
            <div className="text-center py-4 text-caption text-text-tertiary">
              {loadingSubs ? "로딩 중..." : "제출물이 없습니다"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
