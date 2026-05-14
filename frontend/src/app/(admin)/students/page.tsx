"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { PermissionGate } from "@/components/common/permission-gate";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  User,
  Award,
  FileText,
  MessageSquare,
  BarChart3,
  BookOpen,
  PieChart,
  Notebook,
  Download,
  Upload,
  GraduationCap,
  Briefcase,
  Target,
  Eye,
  Globe,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";

interface StudentItem {
  id: number;
  name: string;
  email: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
}

interface PortfolioSummary {
  student: { id: number; name: string; grade: number; class_number: number; student_number: number };
  grade_count: number;
  award_count: number;
  thesis_count: number;
  mock_exam_count: number;
}

type PortfolioTab = "stats" | "grades" | "awards" | "theses" | "counselings" | "mock-exams" | "records" | "artifacts" | "career";

const TAB_CONFIG: { key: PortfolioTab; label: string; icon: any }[] = [
  { key: "stats", label: "누적 통계", icon: PieChart },
  { key: "grades", label: "성적", icon: BookOpen },
  { key: "awards", label: "수상", icon: Award },
  { key: "theses", label: "논문", icon: FileText },
  { key: "counselings", label: "상담", icon: MessageSquare },
  { key: "mock-exams", label: "모의고사", icon: BarChart3 },
  { key: "records", label: "생기부", icon: Notebook },
  { key: "artifacts", label: "산출물", icon: Briefcase },
  { key: "career", label: "진로 설계", icon: Target },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export default function StudentsPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<number | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [activeTab, setActiveTab] = useState<PortfolioTab>("stats");

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ role: "student", page: String(page), per_page: "20" });
      if (search) params.set("search", search);
      const data = await api.get(`/api/users?${params}`);
      setStudents(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const selectStudent = async (sid: number) => {
    setSelectedStudent(sid);
    setActiveTab("stats");
    try {
      const data = await api.get(`/api/students/${sid}/portfolio`);
      setPortfolio(data);
    } catch (err) {
      console.error(err);
    }
  };

  const downloadPdf = async (sid: number) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";
    const url = `${API_URL}/api/students/${sid}/report.pdf`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { alert("PDF 생성 실패"); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${portfolio?.student.name || sid}_portfolio.pdf`;
    a.click();
  };

  const exportCsv = async (sid: number) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";
    const url = `${API_URL}/api/students/${sid}/export.csv`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `student_${sid}_export.csv`;
    a.click();
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="flex gap-6 h-[calc(100vh-120px)]">
      {/* Left panel - Student list */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-title text-text-primary">학생 현황</h1>
          <div className="flex gap-1">
            <Link href="/students/import" className="p-1.5 hover:bg-bg-secondary rounded" title="CSV 일괄 업로드">
              <Upload size={16} className="text-text-secondary" />
            </Link>
            <Link href="/students/cohort" className="p-1.5 hover:bg-bg-secondary rounded" title="진급/졸업 처리">
              <GraduationCap size={16} className="text-text-secondary" />
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <Search size={16} className="text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="학생 검색"
            className="flex-1 px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex-1 overflow-y-auto bg-bg-primary rounded-lg border border-border-default">
          {students.map((s) => (
            <button
              key={s.id}
              onClick={() => selectStudent(s.id)}
              className={`w-full text-left px-4 py-3 border-b border-border-default hover:bg-bg-secondary transition-colors ${
                selectedStudent === s.id ? "bg-accent/5 border-l-2 border-l-accent" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <User size={14} className="text-text-tertiary" />
                <span className="text-body text-text-primary font-medium">{s.name}</span>
              </div>
              <div className="text-caption text-text-tertiary mt-0.5 ml-5">
                {s.grade ? `${s.grade}학년 ${s.class_number}반 ${s.student_number}번` : s.email}
              </div>
            </button>
          ))}
          {students.length === 0 && (
            <div className="p-4 text-center text-body text-text-tertiary">
              {loading ? "로딩 중..." : "학생이 없습니다"}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-caption text-text-secondary">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Right panel - Portfolio */}
      <div className="flex-1 min-w-0">
        {selectedStudent && portfolio ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-title text-text-primary">{portfolio.student.name}</h2>
                <p className="text-caption text-text-tertiary">
                  {portfolio.student.grade}학년 {portfolio.student.class_number}반 {portfolio.student.student_number}번
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex gap-3 text-caption text-text-secondary">
                  <span>성적 {portfolio.grade_count}</span>
                  <span>수상 {portfolio.award_count}</span>
                  <span>논문 {portfolio.thesis_count}</span>
                  <span>모의고사 {portfolio.mock_exam_count}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => exportCsv(selectedStudent)}
                          className="flex items-center gap-1 px-3 py-1.5 border border-border-default rounded text-caption hover:bg-bg-secondary">
                    <Download size={12} /> CSV
                  </button>
                  <button onClick={() => downloadPdf(selectedStudent)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded text-caption">
                    <Download size={12} /> PDF 생기부
                  </button>
                </div>
              </div>
            </div>

            {/* Tabs — 좁아질 때 한글 단어 단위 줄바꿈 (글자 단위 분리 방지) */}
            <div className="flex flex-wrap gap-1 mb-4 bg-bg-secondary rounded-lg p-1">
              {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-body rounded transition-colors [word-break:keep-all] [line-break:strict] ${
                    activeTab === key
                      ? "bg-bg-primary text-accent font-medium shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  <span className="text-center [word-break:keep-all] [line-break:strict]">{label}</span>
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === "stats" && <StatsTab studentId={selectedStudent} />}
            {activeTab === "grades" && <GradesTab studentId={selectedStudent} />}
            {activeTab === "awards" && <AwardsTab studentId={selectedStudent} />}
            {activeTab === "theses" && <ThesesTab studentId={selectedStudent} />}
            {activeTab === "counselings" && <CounselingsTab studentId={selectedStudent} />}
            {activeTab === "mock-exams" && <MockExamsTab studentId={selectedStudent} />}
            {activeTab === "records" && <RecordsTab studentId={selectedStudent} />}
            {activeTab === "artifacts" && <ArtifactsTab studentId={selectedStudent} />}
            {activeTab === "career" && <CareerTab studentId={selectedStudent} />}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-text-tertiary text-body">
            좌측에서 학생을 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}

// ── Grades Tab ──
function GradesTab({ studentId }: { studentId: number }) {
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
function AwardsTab({ studentId }: { studentId: number }) {
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
function ThesesTab({ studentId }: { studentId: number }) {
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
    in_review: { label: "심사중", className: "bg-blue-100 text-blue-700" },
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
function CounselingsTab({ studentId }: { studentId: number }) {
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
function StatsTab({ studentId }: { studentId: number }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/students/${studentId}/stats`)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!stats) return <div className="text-text-tertiary">통계 데이터 없음</div>;

  const maxAvg = Math.max(...stats.grade_trend.map((d: any) => d.avg), 100);

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">총 성적 기록</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.grades}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">수상</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.awards}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">상담</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.counselings}</div>
        </div>
        <div className="bg-bg-primary border border-border-default rounded-lg p-3">
          <div className="text-caption text-text-tertiary">모의고사</div>
          <div className="text-xl font-bold text-text-primary">{stats.totals.mock_exams}</div>
        </div>
      </div>

      {/* 학기별 평균 추이 */}
      {stats.grade_trend.length > 0 && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h3 className="text-body font-semibold mb-3">학기별 평균 점수 추이</h3>
          <div className="flex items-end gap-2 h-32">
            {stats.grade_trend.map((d: any) => (
              <div key={d.period} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="text-caption text-text-tertiary opacity-0 group-hover:opacity-100">{d.avg}점</div>
                <div className="w-full bg-accent rounded-t" style={{ height: `${(d.avg / maxAvg) * 100}%`, minHeight: "2px" }} />
                <div className="text-caption text-text-tertiary">{d.period}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 모의고사 등급 추이 */}
      {stats.mock_trend.length > 0 && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h3 className="text-body font-semibold mb-3">모의고사 등급 추이 (시점별)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="text-caption text-text-tertiary"><tr><th className="text-left p-1">날짜</th><th className="text-left p-1">과목</th><th className="text-right p-1">백분위</th><th className="text-right p-1">등급</th></tr></thead>
              <tbody>
                {stats.mock_trend.map((m: any, i: number) => (
                  <tr key={i} className="border-t border-border-default">
                    <td className="p-1 text-text-tertiary">{m.date}</td>
                    <td className="p-1">{m.subject}</td>
                    <td className="p-1 text-right">{m.percentile ?? "-"}</td>
                    <td className="p-1 text-right">{m.grade_level ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 수상 카테고리별 */}
      {Object.keys(stats.award_by_category).length > 0 && (
        <div className="bg-bg-primary border border-border-default rounded-lg p-4">
          <h3 className="text-body font-semibold mb-3">수상 분야별</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.award_by_category).map(([k, v]: any) => (
              <span key={k} className="px-3 py-1 bg-accent-light text-accent rounded text-caption">{k}: {v}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Records Tab (생기부) ──
function RecordsTab({ studentId }: { studentId: number }) {
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
      setRecords(Array.isArray(data) ? data : []);
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
function MockExamsTab({ studentId }: { studentId: number }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ exam_name: "", exam_date: "", subject: "", raw_score: "", standard_score: "", percentile: "", grade_level: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/students/${studentId}/mock-exams`);
      setRecords(Array.isArray(data) ? data : []);
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
                r.grade_level <= 4 ? "bg-blue-100 text-blue-700" :
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
function ArtifactsTab({ studentId }: { studentId: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    api.get(`/api/students/${studentId}/artifacts`)
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [studentId]);

  const CATS: Record<string, string> = {
    report: "보고서/논문", presentation: "발표자료",
    project: "프로젝트", media: "이미지/영상", other: "기타",
  };

  const filtered = filter === "all" ? items : items.filter((a) => a.category === filter);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-body text-text-secondary">전체 {items.length}건</span>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter("all")}
            className={`px-2 py-1 text-caption rounded ${filter === "all" ? "bg-accent text-white" : "bg-bg-secondary"}`}
          >전체</button>
          {Object.entries(CATS).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-2 py-1 text-caption rounded ${filter === k ? "bg-accent text-white" : "bg-bg-secondary"}`}
            >{label}</button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="py-8 text-center text-text-tertiary border-2 border-dashed border-border-default rounded-lg">
          학생이 등록한 산출물이 없습니다
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((a) => (
            <div key={a.id} className="bg-bg-primary border border-border-default rounded-lg p-3">
              <div className="flex items-start gap-2 mb-2">
                <Briefcase size={14} className="text-accent mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium truncate">{a.title}</div>
                  <div className="text-caption text-text-tertiary">
                    {CATS[a.category] || a.category} · {(a.created_at || "").slice(0, 10)}
                  </div>
                </div>
                {a.is_public && <span className="text-caption px-2 py-0.5 bg-accent-light text-accent rounded">공개</span>}
              </div>
              {a.description && <div className="text-caption text-text-secondary mb-2 line-clamp-2">{a.description}</div>}
              {(a.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {a.tags.map((t: string) => (
                    <span key={t} className="px-2 py-0.5 bg-bg-secondary text-caption rounded">#{t}</span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t border-border-default">
                {a.file_url && (
                  <a href={`${API_URL}${a.file_url}`} target="_blank" rel="noopener"
                     className="flex items-center gap-1 px-2 py-1 text-caption bg-bg-secondary rounded hover:bg-accent-light">
                    <FileText size={12} /> 파일
                  </a>
                )}
                {a.external_link && (
                  <a href={a.external_link} target="_blank" rel="noopener"
                     className="flex items-center gap-1 px-2 py-1 text-caption bg-bg-secondary rounded hover:bg-accent-light">
                    <ExternalLink size={12} /> 링크
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Career Tab (학생 본인 진로 설계 — 교사 조회) ──
function CareerTab({ studentId }: { studentId: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/students/${studentId}/career-plans`)
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-text-tertiary border-2 border-dashed border-border-default rounded-lg">
        학생이 작성한 진로 설계가 없습니다
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((p) => (
        <div key={p.id} className="bg-bg-primary border border-border-default rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target size={16} className="text-accent" />
            <span className="text-body font-semibold">{p.year}년 진로 설계</span>
            {!p.is_active && <span className="text-caption text-text-tertiary">(비활성)</span>}
            <span className="ml-auto text-caption text-text-tertiary">
              최종 수정 {(p.updated_at || "").slice(0, 10)}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-body">
            <div>
              <div className="text-caption text-text-secondary mb-1">희망 진로 분야</div>
              <div>{p.desired_field || "-"}</div>
            </div>
            <div>
              <div className="text-caption text-text-secondary mb-1">장래 직업</div>
              <div>{p.career_goal || "-"}</div>
            </div>
          </div>
          {(p.target_universities || []).length > 0 && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">희망 대학</div>
              <div className="flex flex-wrap gap-1">
                {p.target_universities.map((u: any, i: number) => (
                  <span key={i} className="px-2 py-0.5 bg-accent-light text-accent text-caption rounded">
                    {u.university || u.name} {u.major ? `· ${u.major}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          {p.academic_plan && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">학업 계획</div>
              <div className="whitespace-pre-wrap text-body">{p.academic_plan}</div>
            </div>
          )}
          {p.activity_plan && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">활동 계획</div>
              <div className="whitespace-pre-wrap text-body">{p.activity_plan}</div>
            </div>
          )}
          {p.motivation && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">진학 동기 / 자기소개 초안</div>
              <div className="whitespace-pre-wrap text-body">{p.motivation}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

