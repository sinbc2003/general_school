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
import {
  GradesTab, AwardsTab, ThesesTab, CounselingsTab, StatsTab,
  RecordsTab, MockExamsTab, ArtifactsTab, CareerTab,
} from "./_tabs";

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
