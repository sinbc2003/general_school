"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  Trash2,
  Edit3,
  X,
  ClipboardList,
  Clock,
  CalendarRange,
} from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";

interface CurrentSemester {
  id: number;
  year: number;
  semester: number;
  name: string;
}

interface AssignmentItem {
  id: number;
  title: string;
  subject: string;
  status: string;
  due_date: string;
  submission_count: number;
  created_at: string;
}

interface AssignmentListResponse {
  items: AssignmentItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  active: "진행중",
  closed: "마감",
  grading: "채점중",
  completed: "완료",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  closed: "bg-yellow-100 text-yellow-700",
  grading: "bg-cream-200 text-blue-700",
  completed: "bg-purple-100 text-purple-700",
};

const SUBJECT_OPTIONS = [
  "수학", "국어", "영어", "과학", "사회", "역사", "도덕",
  "물리", "화학", "생물", "지구과학", "기타",
];

const SUBMISSION_FORMAT_OPTIONS = [
  { value: "file", label: "파일 제출" },
  { value: "text", label: "텍스트 입력" },
  { value: "link", label: "링크 제출" },
];

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

function isDueSoon(dateStr: string): boolean {
  if (!dateStr) return false;
  const due = new Date(dateStr);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000; // 3일 이내
}

function isOverdue(dateStr: string): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

interface AssignmentFormData {
  title: string;
  subject: string;
  description: string;
  target_grades: string;
  due_date: string;
  submission_format: string;
}

const EMPTY_FORM: AssignmentFormData = {
  title: "",
  subject: "수학",
  description: "",
  target_grades: "",
  due_date: "",
  submission_format: "file",
};

export default function AssignmentPage() {
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentSem, setCurrentSem] = useState<CurrentSemester | null>(null);

  useEffect(() => {
    api.get<CurrentSemester | null>("/api/timetable/semesters/current")
      .then(setCurrentSem).catch(() => {});
  }, []);

  // 폼 상태
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AssignmentFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (statusFilter) params.set("status", statusFilter);
      if (subjectFilter) params.set("subject", subjectFilter);
      const data = await api.get<AssignmentListResponse>(`/api/assignment?${params}`);
      setAssignments(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "과제 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, subjectFilter]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (assignment: AssignmentItem) => {
    setEditingId(assignment.id);
    setForm({
      title: assignment.title,
      subject: assignment.subject,
      description: "",
      target_grades: "",
      due_date: assignment.due_date ? assignment.due_date.slice(0, 10) : "",
      submission_format: "file",
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      alert("과제 제목을 입력해주세요.");
      return;
    }
    if (!form.due_date) {
      alert("마감일을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const targetGrades = form.target_grades
        ? form.target_grades.split(",").map((g) => Number(g.trim())).filter(Boolean)
        : [];

      const body = {
        title: form.title.trim(),
        subject: form.subject,
        description: form.description.trim() || null,
        target_grades: targetGrades.length > 0 ? targetGrades : null,
        due_date: form.due_date,
        submission_format: form.submission_format,
      };

      if (editingId) {
        await api.put(`/api/assignment/${editingId}`, body);
        alert("수정 완료");
      } else {
        await api.post("/api/assignment", body);
        alert("등록 완료");
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      fetchAssignments();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/assignment/${id}`);
      fetchAssignments();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const updateForm = (key: keyof AssignmentFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title text-text-primary">과제 관리</h1>
          {currentSem && (
            <div className="text-caption text-text-secondary mt-1 flex items-center gap-1">
              <CalendarRange size={12} />
              <span>{currentSem.name} 데이터만 표시됩니다.</span>
            </div>
          )}
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Plus size={14} />
          과제 생성
        </button>
      </div>

      {/* 생성/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-body font-medium text-text-primary">
                {editingId ? "과제 수정" : "과제 생성"}
              </h2>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-text-tertiary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-caption text-text-secondary mb-1">과제 제목 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateForm("title", e.target.value)}
                  placeholder="과제 제목"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-caption text-text-secondary mb-1">과목</label>
                  <select
                    value={form.subject}
                    onChange={(e) => updateForm("subject", e.target.value)}
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                  >
                    {SUBJECT_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-caption text-text-secondary mb-1">마감일 *</label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => updateForm("due_date", e.target.value)}
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-caption text-text-secondary mb-1">대상 학년 (쉼표 구분)</label>
                  <input
                    type="text"
                    value={form.target_grades}
                    onChange={(e) => updateForm("target_grades", e.target.value)}
                    placeholder="예: 1, 2"
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-caption text-text-secondary mb-1">제출 형식</label>
                  <select
                    value={form.submission_format}
                    onChange={(e) => updateForm("submission_format", e.target.value)}
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                  >
                    {SUBMISSION_FORMAT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">설명</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  rows={4}
                  placeholder="과제 설명"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
              >
                {submitting ? "저장 중..." : editingId ? "수정" : "생성"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={subjectFilter}
          onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체 과목</option>
          {SUBJECT_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-caption text-text-tertiary ml-auto">
          총 {total}건
        </span>
      </div>

      <DataTable<AssignmentItem>
        columns={[
          {
            key: "title", label: "과제명",
            render: (a) => (
              <div className="flex items-center gap-2">
                <ClipboardList size={14} className="text-text-tertiary flex-shrink-0" />
                {a.title}
              </div>
            ),
          },
          { key: "subject", label: "과목", render: (a) => <span className="text-text-secondary">{a.subject}</span> },
          {
            key: "status", label: "상태",
            render: (a) => (
              <span className={`inline-block px-2 py-0.5 text-caption rounded ${STATUS_COLORS[a.status] || "bg-gray-100 text-gray-700"}`}>
                {STATUS_LABELS[a.status] || a.status}
              </span>
            ),
          },
          {
            key: "due_date", label: "마감일",
            render: (a) => (
              <div className="flex items-center gap-1">
                {isDueSoon(a.due_date) && <Clock size={12} className="text-status-warning" />}
                <span className={`text-caption ${
                  isOverdue(a.due_date) && a.status === "active" ? "text-status-error" :
                  isDueSoon(a.due_date) ? "text-status-warning" : "text-text-secondary"
                }`}>{formatDate(a.due_date)}</span>
              </div>
            ),
          },
          { key: "submission_count", label: "제출", align: "center", render: (a) => `${a.submission_count}명` },
          { key: "created_at", label: "생성일", render: (a) => <span className="text-caption text-text-tertiary">{formatDate(a.created_at)}</span> },
          {
            key: "actions", label: "작업", align: "center",
            render: (a) => (
              <div className="flex items-center justify-center gap-1">
                <button onClick={() => openEdit(a)} title="수정" className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent">
                  <Edit3 size={14} />
                </button>
                <button onClick={() => handleDelete(a.id)} title="삭제" className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error">
                  <Trash2 size={14} />
                </button>
              </div>
            ),
          },
        ]}
        rows={assignments}
        keyExtractor={(a) => a.id}
        loading={loading}
        emptyText="과제가 없습니다"
        page={page}
        totalPages={totalPages}
        totalCount={total}
        onPageChange={setPage}
      />
    </div>
  );
}
