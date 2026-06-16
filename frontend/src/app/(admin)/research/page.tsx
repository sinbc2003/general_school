"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";
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
  Download,
  MessageSquare,
  BookOpen,
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
  in_progress: { label: "진행중", className: "bg-cream-200 text-blue-700" },
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
  const [tab, setTab] = useState<"journals" | "logs" | "submissions">("journals");
  const [journals, setJournals] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loadingJournals, setLoadingJournals] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingSubs, setLoadingSubs] = useState(true);

  const loadJournals = useCallback(() => {
    api.get(`/api/research/${researchId}/journals`).then((d) => setJournals(Array.isArray(d) ? d : (d?.items || []))).catch(() => setJournals([])).finally(() => setLoadingJournals(false));
  }, [researchId]);
  const loadLogs = useCallback(() => {
    api.get(`/api/research/${researchId}/logs`).then((d) => setLogs(Array.isArray(d) ? d : [])).catch(() => setLogs([])).finally(() => setLoadingLogs(false));
  }, [researchId]);
  const loadSubs = useCallback(() => {
    api.get(`/api/research/${researchId}/submissions`).then((d) => setSubmissions(Array.isArray(d) ? d : [])).catch(() => setSubmissions([])).finally(() => setLoadingSubs(false));
  }, [researchId]);

  useEffect(() => { loadJournals(); loadLogs(); loadSubs(); }, [loadJournals, loadLogs, loadSubs]);

  return (
    <div className="border-t border-border-default px-4 py-3">
      <div className="flex gap-1 mb-3 bg-bg-secondary rounded p-0.5 w-fit">
        <button
          onClick={() => setTab("journals")}
          className={`flex items-center gap-1 px-3 py-1.5 text-caption rounded ${tab === "journals" ? "bg-bg-primary text-accent font-medium shadow-sm" : "text-text-secondary"}`}
        >
          <BookOpen size={14} /> 학생 일지 ({journals.length})
        </button>
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

      {tab === "journals" && (
        <div className="space-y-2">
          {journals.map((j) => <JournalRow key={j.id} journal={j} onSaved={loadJournals} />)}
          {journals.length === 0 && (
            <div className="text-center py-4 text-caption text-text-tertiary">
              {loadingJournals ? "로딩 중..." : "학생이 작성한 일지가 없습니다"}
            </div>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="space-y-2">
          {logs.map((log) => <LogRow key={log.id} log={log} onSaved={loadLogs} />)}
          {logs.length === 0 && (
            <div className="text-center py-4 text-caption text-text-tertiary">
              {loadingLogs ? "로딩 중..." : "연구일지가 없습니다"}
            </div>
          )}
        </div>
      )}

      {tab === "submissions" && (
        <div className="space-y-2">
          {submissions.map((sub) => <SubmissionRow key={sub.id} sub={sub} onReviewed={loadSubs} />)}
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

// ── 학생 일지 1건 — 교사 피드백 작성/수정 ──
function JournalRow({ journal, onSaved }: { journal: any; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [fb, setFb] = useState(journal.feedback || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/research/journals/${journal.id}/feedback`, { feedback: fb });
      setEditing(false);
      onSaved();
    } catch { alert("피드백 저장에 실패했습니다."); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-3 bg-bg-secondary rounded">
      <div className="flex items-center justify-between mb-1">
        <span className="text-caption font-semibold text-accent">{journal.week_number}주차</span>
        <span className="text-caption text-text-tertiary">{journal.created_at?.slice(0, 10)}</span>
      </div>
      <div className="text-caption text-text-secondary whitespace-pre-wrap mb-2">{journal.content}</div>
      {editing ? (
        <div>
          <textarea
            value={fb} onChange={(e) => setFb(e.target.value)} rows={3} autoFocus
            placeholder="피드백을 작성하세요"
            className="w-full border border-border-default rounded px-2 py-1.5 text-caption bg-bg-primary text-text-primary resize-none"
          />
          <div className="flex gap-2 mt-1">
            <button onClick={save} disabled={saving} className="px-3 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40">{saving ? "저장 중..." : "저장"}</button>
            <button onClick={() => { setEditing(false); setFb(journal.feedback || ""); }} className="px-3 py-1 text-caption border border-border-default rounded hover:bg-bg-primary">취소</button>
          </div>
        </div>
      ) : journal.feedback ? (
        <div className="flex items-start justify-between gap-2 bg-bg-primary rounded p-2">
          <div className="text-caption text-accent"><span className="font-medium">피드백:</span> {journal.feedback}</div>
          <button onClick={() => setEditing(true)} className="text-caption text-text-tertiary hover:text-accent shrink-0">수정</button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-caption text-accent">
          <MessageSquare size={12} /> 피드백 작성
        </button>
      )}
    </div>
  );
}

// ── 연구일지 1건 — 교사 피드백 작성/수정 ──
function LogRow({ log, onSaved }: { log: any; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [fb, setFb] = useState(log.feedback || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/research/logs/${log.id}/feedback`, { feedback: fb });
      setEditing(false);
      onSaved();
    } catch { alert("피드백 저장에 실패했습니다."); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-3 bg-bg-secondary rounded">
      <div className="flex items-center justify-between mb-1">
        <span className="text-body text-text-primary font-medium">{log.title}</span>
        <span className="text-caption text-text-tertiary">{log.created_at?.slice(0, 10)}</span>
      </div>
      <div className="text-caption text-text-secondary whitespace-pre-wrap mb-2">{log.content}</div>
      {editing ? (
        <div>
          <textarea
            value={fb} onChange={(e) => setFb(e.target.value)} rows={3} autoFocus
            placeholder="피드백을 작성하세요"
            className="w-full border border-border-default rounded px-2 py-1.5 text-caption bg-bg-primary text-text-primary resize-none"
          />
          <div className="flex gap-2 mt-1">
            <button onClick={save} disabled={saving} className="px-3 py-1 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40">{saving ? "저장 중..." : "저장"}</button>
            <button onClick={() => { setEditing(false); setFb(log.feedback || ""); }} className="px-3 py-1 text-caption border border-border-default rounded hover:bg-bg-primary">취소</button>
          </div>
        </div>
      ) : log.feedback ? (
        <div className="flex items-start justify-between gap-2 bg-bg-primary rounded p-2">
          <div className="text-caption text-accent"><span className="font-medium">피드백:</span> {log.feedback}</div>
          <button onClick={() => setEditing(true)} className="text-caption text-text-tertiary hover:text-accent shrink-0">수정</button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-caption text-accent">
          <MessageSquare size={12} /> 피드백 작성
        </button>
      )}
    </div>
  );
}

// ── 산출물 1건 — 다운로드 + 승인/반려 + 의견 ──
function SubmissionRow({ sub, onReviewed }: { sub: any; onReviewed: () => void }) {
  const [comment, setComment] = useState(sub.review_comment || "");
  const [showComment, setShowComment] = useState(false);
  const [busy, setBusy] = useState(false);

  const review = async (status: "approved" | "rejected" | "pending") => {
    setBusy(true);
    try {
      await api.patch(`/api/research/submissions/${sub.id}/review`, {
        review_status: status,
        review_comment: comment || null,
      });
      setShowComment(false);
      onReviewed();
    } catch { alert("심사 저장에 실패했습니다."); }
    finally { setBusy(false); }
  };

  const badge =
    sub.review_status === "approved" ? ["승인", "bg-green-100 text-green-700"] :
    sub.review_status === "rejected" ? ["반려", "bg-red-100 text-red-700"] :
    ["대기", "bg-yellow-100 text-yellow-700"];

  return (
    <div className="p-3 bg-bg-secondary rounded">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-body text-text-primary truncate">{sub.title}</div>
          <div className="text-caption text-text-tertiary">
            {sub.submission_type} | {sub.filename} ({sub.file_size ? `${(sub.file_size / 1024).toFixed(0)}KB` : "-"})
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 text-caption rounded ${badge[1]}`}>{badge[0]}</span>
          {sub.file_url && (
            <button onClick={() => downloadSecure(sub.file_url, sub.filename)} title="다운로드"
              className="p-1.5 text-text-secondary hover:text-accent hover:bg-bg-primary rounded">
              <Download size={14} />
            </button>
          )}
        </div>
      </div>
      {sub.review_comment && !showComment && (
        <div className="text-caption text-text-secondary mt-1.5">심사 의견: {sub.review_comment}</div>
      )}
      {showComment ? (
        <div className="mt-2">
          <textarea
            value={comment} onChange={(e) => setComment(e.target.value)} rows={2} autoFocus
            placeholder="심사 의견 (선택)"
            className="w-full border border-border-default rounded px-2 py-1.5 text-caption bg-bg-primary text-text-primary resize-none"
          />
          <div className="flex gap-2 mt-1">
            <button onClick={() => review("approved")} disabled={busy} className="px-3 py-1 text-caption bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40">승인</button>
            <button onClick={() => review("rejected")} disabled={busy} className="px-3 py-1 text-caption bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40">반려</button>
            <button onClick={() => review("pending")} disabled={busy} className="px-3 py-1 text-caption border border-border-default rounded hover:bg-bg-primary">대기로</button>
            <button onClick={() => { setShowComment(false); setComment(sub.review_comment || ""); }} className="px-3 py-1 text-caption text-text-tertiary">취소</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => review("approved")} disabled={busy} className="px-3 py-1 text-caption bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40">승인</button>
          <button onClick={() => review("rejected")} disabled={busy} className="px-3 py-1 text-caption bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40">반려</button>
          <button onClick={() => setShowComment(true)} className="flex items-center gap-1 text-caption text-accent">
            <MessageSquare size={12} /> 의견 작성
          </button>
        </div>
      )}
    </div>
  );
}
