"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  Trash2,
  Edit3,
  Trophy,
  Users,
  CalendarRange,
} from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal, ModalFooter } from "@/components/ui/Modal";

interface CurrentSemester {
  id: number;
  year: number;
  semester: number;
  name: string;
}

interface ContestItem {
  id: number;
  title: string;
  contest_type: string;
  status: string;
  is_visible: boolean;
  start_at: string;
  end_at: string;
  participant_count: number;
  created_at: string;
}

interface ContestListResponse {
  items: ContestItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  active: "진행중",
  ended: "종료",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  ended: "bg-red-100 text-red-700",
};

const CONTEST_TYPE_LABELS: Record<string, string> = {
  individual: "개인전",
  team: "팀전",
  online: "온라인",
  offline: "오프라인",
};

function formatDateTime(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

interface ContestFormData {
  title: string;
  description: string;
  contest_type: string;
  rules: string;
  start_at: string;
  end_at: string;
  is_visible: boolean;
  status: string;
}

const EMPTY_FORM: ContestFormData = {
  title: "",
  description: "",
  contest_type: "individual",
  rules: "",
  start_at: "",
  end_at: "",
  is_visible: true,
  status: "draft",
};

export default function ContestPage() {
  const [contests, setContests] = useState<ContestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentSem, setCurrentSem] = useState<CurrentSemester | null>(null);

  useEffect(() => {
    api.get<CurrentSemester | null>("/api/timetable/semesters/current")
      .then(setCurrentSem).catch(() => {});
  }, []);

  // 폼 상태
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ContestFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchContests = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get<ContestListResponse>(`/api/contest?${params}`);
      setContests(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "대회 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    fetchContests();
  }, [fetchContests]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (contest: ContestItem) => {
    setEditingId(contest.id);
    setForm({
      title: contest.title,
      description: "",
      contest_type: contest.contest_type,
      rules: "",
      start_at: contest.start_at ? contest.start_at.slice(0, 16) : "",
      end_at: contest.end_at ? contest.end_at.slice(0, 16) : "",
      is_visible: contest.is_visible,
      status: contest.status,
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      alert("대회 제목을 입력해주세요.");
      return;
    }
    if (!form.start_at || !form.end_at) {
      alert("시작일과 종료일을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const body: any = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        contest_type: form.contest_type,
        rules: form.rules.trim() || null,
        start_at: form.start_at,
        end_at: form.end_at,
        is_visible: form.is_visible,
      };

      if (editingId) {
        body.status = form.status;
        await api.put(`/api/contest/${editingId}`, body);
        alert("수정 완료");
      } else {
        await api.post("/api/contest", body);
        alert("등록 완료");
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      fetchContests();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/contest/${id}`);
      fetchContests();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const updateForm = (key: keyof ContestFormData, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title text-text-primary">대회 관리</h1>
          {currentSem && (
            <div className="text-caption text-text-secondary mt-1 flex items-center gap-1">
              <CalendarRange size={12} />
              <span>{currentSem.name} 데이터만 표시됩니다 (학기는 시스템 → 학기 관리에서 변경).</span>
            </div>
          )}
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Plus size={14} />
          대회 생성
        </button>
      </div>

      {/* 생성/수정 모달 */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditingId(null); }}
        title={editingId ? "대회 수정" : "대회 생성"}
        maxWidth="2xl"
      >
        <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">대회 제목 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateForm("title", e.target.value)}
                  placeholder="대회 제목"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">대회 유형</label>
                <select
                  value={form.contest_type}
                  onChange={(e) => updateForm("contest_type", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                >
                  {Object.entries(CONTEST_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              {editingId && (
                <div>
                  <label className="block text-caption text-text-secondary mb-1">상태</label>
                  <select
                    value={form.status}
                    onChange={(e) => updateForm("status", e.target.value)}
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
                  >
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className={editingId ? "" : ""}>
                <label className="block text-caption text-text-secondary mb-1">공개 여부</label>
                <label className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    checked={form.is_visible}
                    onChange={(e) => updateForm("is_visible", e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-body text-text-primary">학생에게 공개</span>
                </label>
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">시작일시 *</label>
                <input
                  type="datetime-local"
                  value={form.start_at}
                  onChange={(e) => updateForm("start_at", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">종료일시 *</label>
                <input
                  type="datetime-local"
                  value={form.end_at}
                  onChange={(e) => updateForm("end_at", e.target.value)}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">설명</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  rows={3}
                  placeholder="대회 설명"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-caption text-text-secondary mb-1">규칙</label>
                <textarea
                  value={form.rules}
                  onChange={(e) => updateForm("rules", e.target.value)}
                  rows={3}
                  placeholder="대회 규칙"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                />
              </div>
        </div>
        <ModalFooter>
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
        </ModalFooter>
      </Modal>

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
        <span className="text-caption text-text-tertiary ml-auto">
          총 {total}건
        </span>
      </div>

      {/* 테이블 + 페이지네이션 (공통 DataTable) */}
      <DataTable<ContestItem>
        columns={[
          {
            key: "title", label: "대회명",
            render: (c) => (
              <div className="flex items-center gap-2">
                <Trophy size={14} className="text-text-tertiary flex-shrink-0" />
                {c.title}
              </div>
            ),
          },
          { key: "contest_type", label: "유형", render: (c) => CONTEST_TYPE_LABELS[c.contest_type] || c.contest_type },
          {
            key: "status", label: "상태",
            render: (c) => (
              <span className={`inline-block px-2 py-0.5 text-caption rounded ${STATUS_COLORS[c.status] || "bg-gray-100 text-gray-700"}`}>
                {STATUS_LABELS[c.status] || c.status}
              </span>
            ),
          },
          { key: "is_visible", label: "공개", render: (c) => (c.is_visible ? "공개" : "비공개") },
          { key: "start_at", label: "시작일시", render: (c) => <span className="text-caption text-text-secondary">{formatDateTime(c.start_at)}</span> },
          { key: "end_at", label: "종료일시", render: (c) => <span className="text-caption text-text-secondary">{formatDateTime(c.end_at)}</span> },
          {
            key: "participant_count", label: "참가자", align: "center",
            render: (c) => (
              <div className="flex items-center justify-center gap-1">
                <Users size={14} className="text-text-tertiary" />
                {c.participant_count}
              </div>
            ),
          },
          { key: "created_at", label: "생성일", render: (c) => <span className="text-caption text-text-tertiary">{formatDate(c.created_at)}</span> },
          {
            key: "actions", label: "작업", align: "center",
            render: (c) => (
              <div className="flex items-center justify-center gap-1">
                <button onClick={() => openEdit(c)} title="수정" className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent">
                  <Edit3 size={14} />
                </button>
                <button onClick={() => handleDelete(c.id)} title="삭제" className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error">
                  <Trash2 size={14} />
                </button>
              </div>
            ),
          },
        ]}
        rows={contests}
        keyExtractor={(c) => c.id}
        loading={loading}
        emptyText="대회가 없습니다"
        page={page}
        totalPages={totalPages}
        totalCount={total}
        onPageChange={setPage}
      />
    </div>
  );
}
