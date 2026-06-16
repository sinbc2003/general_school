"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "@/lib/api/client";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  MessageCircleQuestion,
  GraduationCap,
  Search,
  Target,
  Sparkles,
  Loader2,
  X,
} from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";

type MainTab = "plan" | "records" | "questions";

const TABS: { key: MainTab; label: string; icon: any }[] = [
  { key: "plan", label: "진학설계", icon: Target },
  { key: "records", label: "진학기록", icon: GraduationCap },
  { key: "questions", label: "면접질문", icon: MessageCircleQuestion },
];

export default function AdmissionsPage() {
  const [tab, setTab] = useState<MainTab>("plan");

  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">진학 관리</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-bg-secondary rounded-lg p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-body rounded transition-colors ${
              tab === key
                ? "bg-bg-primary text-accent font-medium shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === "plan" && <PlanTab />}
      {tab === "records" && <RecordsTab />}
      {tab === "questions" && <QuestionsTab />}
    </div>
  );
}

// ── Plan Tab (진학설계) — 학생 데이터 기반 AI 대학 추천 ──
interface StudentRow {
  id: number; name: string;
  grade?: number | null; class_number?: number | null; student_number?: number | null;
}
interface RecommendResult { student_name: string; recommendation: string; cost_usd: number; has_profile: boolean }

function PlanTab() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StudentRow | null>(null);
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get<{ items: StudentRow[] }>(
          `/api/users/peers?role=student&per_page=20&search=${encodeURIComponent(search.trim())}`
        );
        setResults(r.items || []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const stuNo = (s: StudentRow) =>
    s.grade && s.class_number && s.student_number
      ? `${s.grade}${String(s.class_number).padStart(2, "0")}${String(s.student_number).padStart(2, "0")}`
      : "";

  const run = async () => {
    if (!selected) return;
    setRunning(true); setError(""); setResult(null);
    try {
      const r = await api.post<RecommendResult>("/api/admissions/recommend", {
        student_id: selected.id, note: note.trim() || null,
      });
      setResult(r);
    } catch (e: any) {
      setError(e?.detail || "추천 생성 실패 — /system/llm/config에서 AI 모델·API 키를 확인하세요.");
    } finally { setRunning(false); }
  };

  return (
    <div>
      <div className="bg-bg-primary border border-border-default rounded-lg p-5 mb-4">
        <div className="flex items-start gap-3">
          <Sparkles size={22} className="text-accent flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-body font-semibold text-text-primary mb-1">진학설계 (AI 추천)</h2>
            <p className="text-caption text-text-secondary">
              학생의 내신·모의고사·수상·진로희망을 분석해 <b>상향·적정·안정 대학</b>을 근거와 함께 추천합니다.
              학교 챗봇에 설정된 AI 모델을 사용합니다.
            </p>
          </div>
        </div>
      </div>

      {/* 학생 선택 */}
      {!selected ? (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <label className="text-caption text-text-secondary mb-1.5 block">학생 검색 (이름)</label>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
              placeholder="학생 이름을 입력하세요"
              className="w-full pl-8 pr-3 py-2 text-body border border-border-default rounded bg-bg-primary outline-none focus:border-accent"
            />
          </div>
          <div className="border border-border-default rounded max-h-72 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-6 text-caption text-text-tertiary inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> 검색 중...</div>
            ) : !search.trim() ? (
              <div className="px-3 py-6 text-caption text-text-tertiary text-center">이름을 입력해 학생을 검색하세요.</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-6 text-caption text-text-tertiary text-center">검색 결과가 없습니다.</div>
            ) : results.map((s) => (
              <button key={s.id} onClick={() => { setSelected(s); setResult(null); setError(""); }}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary text-left">
                <span className="text-body text-text-primary">{s.name}
                  {stuNo(s) && <span className="text-[11px] text-text-tertiary ml-2">{stuNo(s)}</span>}
                </span>
                <Target size={14} className="text-accent" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-body text-text-primary font-medium">
              {selected.name}
              {stuNo(selected) && <span className="text-caption text-text-tertiary ml-2">{stuNo(selected)}</span>}
            </div>
            <button onClick={() => { setSelected(null); setResult(null); setError(""); setNote(""); }}
              className="text-caption text-text-tertiary hover:text-accent inline-flex items-center gap-1">
              <X size={13} /> 다른 학생
            </button>
          </div>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="교사 메모(선택) — 예: 의대 희망, 정시 위주 등 추가 고려사항"
            className="w-full border border-border-default rounded px-3 py-2 text-caption bg-bg-secondary text-text-primary resize-none mb-3"
          />
          <button onClick={run} disabled={running}
            className="px-4 py-2 bg-accent text-white text-body rounded hover:bg-accent-hover disabled:opacity-50 inline-flex items-center gap-1.5">
            {running ? <><Loader2 size={15} className="animate-spin" /> 분석 중...</> : <><Sparkles size={15} /> 진학설계 시작</>}
          </button>

          {error && <div className="mt-3 text-caption text-status-error bg-red-50 border border-red-100 rounded p-3">{error}</div>}

          {result && (
            <div className="mt-4">
              {!result.has_profile && (
                <div className="text-caption text-status-warning bg-yellow-50 border border-yellow-100 rounded p-2 mb-3">
                  이 학생의 성적·모의고사 데이터가 부족해 일반적 가이드 위주입니다.
                </div>
              )}
              <div className="prose prose-sm max-w-none border border-border-default rounded-lg p-4 bg-bg-secondary text-text-primary
                prose-headings:text-text-primary prose-strong:text-text-primary prose-li:text-text-secondary prose-p:text-text-secondary">
                <ReactMarkdown>{result.recommendation}</ReactMarkdown>
              </div>
              <div className="text-[11px] text-text-tertiary mt-1.5">
                AI 추천 · 참고용이며 최종 판단은 교사·학생이 합니다 · 비용 ${result.cost_usd}
              </div>
            </div>
          )}
        </div>
      )}
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

      <DataTable<any>
        searchable
        searchPlaceholder="대학교·학과·질문 검색"
        exportable
        exportFileName="admissions_questions.csv"
        columns={[
          { key: "university", label: "대학교", sortable: true },
          { key: "department", label: "학과", sortable: true, render: (q) => <span className="text-text-secondary whitespace-nowrap">{q.department}</span> },
          { key: "year", label: "년도", sortable: true, render: (q) => <span className="text-text-tertiary">{q.year}</span> },
          {
            key: "category", label: "분류",
            render: (q) => q.category && (
              <span className="inline-block px-2 py-0.5 text-caption rounded bg-cream-200 text-blue-700">{q.category}</span>
            ),
          },
          {
            key: "question_text", label: "질문",
            render: (q) => <div className="line-clamp-2 max-w-md">{q.question_text}</div>,
          },
        ]}
        rows={items}
        keyExtractor={(q) => q.id}
        loading={loading}
        emptyText="면접질문이 없습니다"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
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

      <DataTable<any>
        searchable
        searchPlaceholder="학생·대학교·학과 검색"
        exportable
        exportFileName="admissions_records.csv"
        columns={[
          { key: "student_name", label: "학생", sortable: true },
          { key: "university", label: "대학교", sortable: true },
          { key: "department", label: "학과", render: (r) => <span className="text-text-secondary">{r.department}</span> },
          { key: "admission_type", label: "전형", render: (r) => <span className="text-text-secondary">{r.admission_type}</span> },
          { key: "year", label: "년도", sortable: true, render: (r) => <span className="text-text-tertiary">{r.year}</span> },
          {
            key: "result", label: "결과", align: "center",
            render: (r) => {
              const result = RESULT_CONFIG[r.result] || { label: r.result, className: "bg-gray-100 text-gray-700" };
              return (
                <span className={`inline-block px-2 py-0.5 text-caption rounded ${result.className}`}>
                  {result.label}
                </span>
              );
            },
          },
        ]}
        rows={items}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyText="진학기록이 없습니다"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
