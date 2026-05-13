"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit3,
  X,
  Calendar,
  MapPin,
  Users,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface MeetingItem {
  id: number;
  title: string;
  date: string;
  department: string | null;
  location: string;
  status: string;
  attendees: string[];
}

interface MeetingListResponse {
  items: MeetingItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface MeetingDetail extends MeetingItem {
  agenda: string | null;
  minutes: string | null;
  decisions: string | null;
}

import { useAuth } from "@/lib/auth-context";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "예정",
  in_progress: "진행중",
  completed: "완료",
  cancelled: "취소",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-700",
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

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

interface MeetingFormData {
  title: string;
  department: string;
  date: string;
  location: string;
  attendees: string;
  agenda: string;
  minutes: string;
  decisions: string;
  status: string;
}

const EMPTY_FORM: MeetingFormData = {
  title: "",
  department: "",
  date: "",
  location: "",
  attendees: "",
  agenda: "",
  minutes: "",
  decisions: "",
  status: "scheduled",
};

export default function MeetingPage() {
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { user, isAdmin } = useAuth();

  // 폼 상태
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MeetingFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // 상세 보기
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<MeetingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (statusFilter) params.set("status", statusFilter);
      if (deptFilter) params.set("department", deptFilter);
      const data = await api.get<MeetingListResponse>(`/api/meeting?${params}`);
      setMeetings(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "협의록 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, deptFilter]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  useEffect(() => {
    api.get<string[]>("/api/meeting/departments").then(setDepartments).catch(() => {});
  }, []);

  const toggleDetail = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetailData(null);
      return;
    }

    setExpandedId(id);
    setDetailLoading(true);
    try {
      const data = await api.get<MeetingDetail>(`/api/meeting/${id}`);
      setDetailData(data);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "상세 조회 실패");
      setExpandedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = async (meeting: MeetingItem) => {
    setEditingId(meeting.id);
    try {
      const detail = await api.get<MeetingDetail>(`/api/meeting/${meeting.id}`);
      setForm({
        title: detail.title,
        department: detail.department || "",
        date: detail.date ? detail.date.slice(0, 16) : "",
        location: detail.location || "",
        attendees: detail.attendees?.join(", ") || "",
        agenda: detail.agenda || "",
        minutes: detail.minutes || "",
        decisions: detail.decisions || "",
        status: detail.status,
      });
    } catch {
      setForm({
        title: meeting.title,
        department: meeting.department || "",
        date: meeting.date ? meeting.date.slice(0, 16) : "",
        location: meeting.location || "",
        attendees: meeting.attendees?.join(", ") || "",
        agenda: "",
        minutes: "",
        decisions: "",
        status: meeting.status,
      });
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      alert("회의 제목을 입력해주세요.");
      return;
    }
    if (!form.date) {
      alert("날짜를 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const attendeesList = form.attendees
        ? form.attendees.split(",").map((a) => a.trim()).filter(Boolean)
        : [];

      const body: any = {
        title: form.title.trim(),
        department: form.department.trim() || null,
        date: form.date,
        location: form.location.trim() || null,
        attendees: attendeesList,
        agenda: form.agenda.trim() || null,
      };

      if (editingId) {
        body.minutes = form.minutes.trim() || null;
        body.decisions = form.decisions.trim() || null;
        body.status = form.status;
        await api.put(`/api/meeting/${editingId}`, body);
        alert("수정 완료");
      } else {
        await api.post("/api/meeting", body);
        alert("등록 완료");
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      // 상세 캐시 초기화
      if (expandedId) {
        setExpandedId(null);
        setDetailData(null);
      }
      fetchMeetings();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/meeting/${id}`);
      if (expandedId === id) {
        setExpandedId(null);
        setDetailData(null);
      }
      fetchMeetings();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const updateForm = (key: keyof MeetingFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">협의록</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Plus size={14} />
          회의 등록
        </button>
      </div>

      {/* 생성/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-body font-medium text-text-primary">
                {editingId ? "협의록 수정" : "회의 등록"}
              </h2>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-text-tertiary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-caption text-text-secondary mb-1">회의 제목 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateForm("title", e.target.value)}
                  placeholder="회의 제목"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">교과 (비우면 전체 공개)</label>
                <input
                  type="text"
                  value={form.department}
                  onChange={(e) => updateForm("department", e.target.value)}
                  placeholder={user?.department || "예: 수학, 영어, 과학"}
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                  list="dept-list"
                />
                <datalist id="dept-list">
                  {departments.map((d) => <option key={d} value={d} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-caption text-text-secondary mb-1">날짜/시간 *</label>
                  <input
                    type="datetime-local"
                    value={form.date}
                    onChange={(e) => updateForm("date", e.target.value)}
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-caption text-text-secondary mb-1">장소</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) => updateForm("location", e.target.value)}
                    placeholder="회의실, 온라인 등"
                    className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                  />
                </div>
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
              <div>
                <label className="block text-caption text-text-secondary mb-1">참석자 (쉼표 구분)</label>
                <input
                  type="text"
                  value={form.attendees}
                  onChange={(e) => updateForm("attendees", e.target.value)}
                  placeholder="홍길동, 김철수, 이영희"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-caption text-text-secondary mb-1">안건</label>
                <textarea
                  value={form.agenda}
                  onChange={(e) => updateForm("agenda", e.target.value)}
                  rows={3}
                  placeholder="회의 안건"
                  className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                />
              </div>
              {editingId && (
                <>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">회의록</label>
                    <textarea
                      value={form.minutes}
                      onChange={(e) => updateForm("minutes", e.target.value)}
                      rows={5}
                      placeholder="회의 내용을 기록하세요"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-text-secondary mb-1">결정 사항</label>
                    <textarea
                      value={form.decisions}
                      onChange={(e) => updateForm("decisions", e.target.value)}
                      rows={3}
                      placeholder="회의에서 결정된 사항"
                      className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                    />
                  </div>
                </>
              )}
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
                {submitting ? "저장 중..." : editingId ? "수정" : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center gap-3 mb-4">
        {isAdmin && departments.length > 0 && (
          <select
            value={deptFilter}
            onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          >
            <option value="">전체 교과</option>
            <option value="__all__">전체 공개만</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
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

      {/* 목록 */}
      <div className="space-y-2">
        {meetings.map((m) => (
          <div key={m.id} className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
            {/* 헤더 행 */}
            <div
              className="flex items-center px-4 py-3 cursor-pointer hover:bg-bg-secondary"
              onClick={() => toggleDetail(m.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-body font-medium text-text-primary truncate">{m.title}</span>
                  {m.department && (
                    <span className="inline-block px-2 py-0.5 text-caption rounded flex-shrink-0 bg-purple-100 text-purple-700">
                      {m.department}
                    </span>
                  )}
                  {!m.department && (
                    <span className="inline-block px-2 py-0.5 text-caption rounded flex-shrink-0 bg-gray-100 text-gray-500">
                      전체
                    </span>
                  )}
                  <span className={`inline-block px-2 py-0.5 text-caption rounded flex-shrink-0 ${STATUS_COLORS[m.status] || "bg-gray-100 text-gray-700"}`}>
                    {STATUS_LABELS[m.status] || m.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-caption text-text-tertiary">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} />
                    {formatDateTime(m.date)}
                  </span>
                  {m.location && (
                    <span className="flex items-center gap-1">
                      <MapPin size={12} />
                      {m.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Users size={12} />
                    {m.attendees?.length || 0}명
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(m); }}
                  title="수정"
                  className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-accent"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                  title="삭제"
                  className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-status-error"
                >
                  <Trash2 size={14} />
                </button>
                {expandedId === m.id ? (
                  <ChevronUp size={16} className="text-text-tertiary" />
                ) : (
                  <ChevronDown size={16} className="text-text-tertiary" />
                )}
              </div>
            </div>

            {/* 상세 패널 */}
            {expandedId === m.id && (
              <div className="border-t border-border-default px-4 py-3">
                {detailLoading ? (
                  <div className="text-center text-body text-text-tertiary py-4">로딩 중...</div>
                ) : detailData ? (
                  <div className="space-y-3">
                    {/* 참석자 */}
                    <div>
                      <div className="flex items-center gap-1 text-caption text-text-tertiary mb-1">
                        <Users size={12} />
                        참석자
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {detailData.attendees?.map((name, i) => (
                          <span key={i} className="inline-block px-2 py-0.5 text-caption bg-bg-secondary text-text-secondary rounded">
                            {name}
                          </span>
                        ))}
                        {(!detailData.attendees || detailData.attendees.length === 0) && (
                          <span className="text-caption text-text-tertiary">-</span>
                        )}
                      </div>
                    </div>

                    {/* 안건 */}
                    {detailData.agenda && (
                      <div>
                        <div className="flex items-center gap-1 text-caption text-text-tertiary mb-1">
                          <FileText size={12} />
                          안건
                        </div>
                        <div className="text-body text-text-primary whitespace-pre-wrap bg-bg-secondary rounded p-3">
                          {detailData.agenda}
                        </div>
                      </div>
                    )}

                    {/* 회의록 */}
                    {detailData.minutes && (
                      <div>
                        <div className="flex items-center gap-1 text-caption text-text-tertiary mb-1">
                          <FileText size={12} />
                          회의록
                        </div>
                        <div className="text-body text-text-primary whitespace-pre-wrap bg-bg-secondary rounded p-3">
                          {detailData.minutes}
                        </div>
                      </div>
                    )}

                    {/* 결정 사항 */}
                    {detailData.decisions && (
                      <div>
                        <div className="flex items-center gap-1 text-caption text-text-tertiary mb-1">
                          <FileText size={12} />
                          결정 사항
                        </div>
                        <div className="text-body text-text-primary whitespace-pre-wrap bg-bg-secondary rounded p-3">
                          {detailData.decisions}
                        </div>
                      </div>
                    )}

                    {!detailData.agenda && !detailData.minutes && !detailData.decisions && (
                      <div className="text-caption text-text-tertiary text-center py-2">
                        아직 작성된 내용이 없습니다.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}

        {meetings.length === 0 && (
          <div className="bg-bg-primary rounded-lg border border-border-default px-4 py-8 text-center text-body text-text-tertiary">
            {loading ? "로딩 중..." : "협의록이 없습니다"}
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages} ({total}건)
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
  );
}
