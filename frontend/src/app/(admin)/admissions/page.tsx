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
  Target,
  Sparkles,
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

// ── Plan Tab (진학설계) — 학생 데이터 기반 대학 추천 (placeholder, 추후 로직 추가) ──
function PlanTab() {
  return (
    <div>
      <div className="bg-bg-primary border border-border-default rounded-lg p-6 mb-4">
        <div className="flex items-start gap-3">
          <Sparkles size={24} className="text-accent flex-shrink-0 mt-1" />
          <div>
            <h2 className="text-body font-semibold text-text-primary mb-2">진학설계 (AI 추천)</h2>
            <p className="text-body text-text-secondary mb-3">
              학생 현황(성적·수상·모의고사·동아리·논문·진로희망)을 기반으로
              <b> 적합한 대학·학과·전형을 자동 추천</b>합니다.
            </p>
            <ul className="text-caption text-text-tertiary space-y-1 list-disc list-inside">
              <li>모의고사 등급·내신 기반 정시·수시 라인 추출</li>
              <li>수상·논문·동아리 활동을 학과 인재상과 매칭</li>
              <li>3개 단계 (상향·적정·안정) 별 5~10개 대학 추천</li>
              <li>각 추천 카드에 "왜 추천했나" 근거 표시</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-bg-secondary border border-border-default rounded-lg p-6 text-center text-text-tertiary">
        <Target size={32} className="mx-auto mb-2 opacity-50" />
        <div className="text-body mb-1">아직 학생을 선택하지 않았습니다</div>
        <div className="text-caption">
          좌측 "학생지도 → 학생 현황"에서 학생을 선택한 후 "진학설계 시작" 버튼을 누르세요. (구현 예정)
        </div>
      </div>
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
              <span className="inline-block px-2 py-0.5 text-caption rounded bg-blue-100 text-blue-700">{q.category}</span>
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
