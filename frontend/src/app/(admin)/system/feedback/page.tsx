"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { Bug, Lightbulb, HelpCircle, Bot } from "lucide-react";

interface FeedbackItem {
  id: number;
  user_id: number;
  feedback_type: string;
  content: string;
  page_url: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
}

const TYPE_ICONS: Record<string, any> = {
  bug: { icon: Bug, label: "오류", color: "text-red-500" },
  feature: { icon: Lightbulb, label: "건의", color: "text-amber-500" },
  other: { icon: HelpCircle, label: "문의", color: "text-blue-500" },
};

const STATUS_OPTIONS = [
  { value: "pending", label: "접수", color: "bg-gray-200 text-gray-700" },
  { value: "in_progress", label: "처리중", color: "bg-blue-100 text-blue-700" },
  { value: "resolved", label: "완료", color: "bg-green-100 text-green-700" },
  { value: "dismissed", label: "반려", color: "bg-red-100 text-red-700" },
];

export default function FeedbackManagePage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "30" });
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get(`/api/feedback?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch {}
  }, [page, statusFilter]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const updateStatus = async (id: number, status: string) => {
    setSaving(true);
    try {
      await api.fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, admin_note: adminNote || undefined }),
      });
      fetchList();
      if (selected?.id === id) {
        setSelected({ ...selected, status, admin_note: adminNote || selected.admin_note });
      }
    } catch (err: any) {
      alert(err?.detail || "업데이트 실패");
    } finally {
      setSaving(false);
    }
  };

  const createDevRequest = async (fb: FeedbackItem) => {
    try {
      await api.post("/api/ai-developer", {
        feedback_id: fb.id,
        title: `[${fb.feedback_type}] ${fb.content.slice(0, 50)}`,
        prompt: fb.content,
        request_type: fb.feedback_type === "bug" ? "bugfix" : "feature",
      });
      alert("AI 개발 요청이 생성되었습니다. AI 개발자 페이지에서 확인하세요.");
    } catch (err: any) {
      alert(err?.detail || "생성 실패");
    }
  };

  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">건의 관리</h1>

      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="">전체</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="text-caption text-text-tertiary ml-auto">총 {total}건</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 목록 */}
        <div className="space-y-2">
          {items.map((fb) => {
            const tp = TYPE_ICONS[fb.feedback_type] || TYPE_ICONS.other;
            const st = STATUS_OPTIONS.find((s) => s.value === fb.status) || STATUS_OPTIONS[0];
            const Icon = tp.icon;
            return (
              <div
                key={fb.id}
                onClick={() => { setSelected(fb); setAdminNote(fb.admin_note || ""); }}
                className={`p-4 bg-bg-primary border rounded-lg cursor-pointer hover:border-accent transition-colors ${
                  selected?.id === fb.id ? "border-accent" : "border-border-default"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className={tp.color} />
                  <span className="text-[12px] font-medium">{tp.label}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                  <span className="text-[11px] text-text-tertiary ml-auto">
                    {new Date(fb.created_at).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                <p className="text-[13px] text-text-primary line-clamp-2">{fb.content}</p>
                {fb.page_url && (
                  <div className="text-[11px] text-text-tertiary mt-1">페이지: {fb.page_url}</div>
                )}
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="p-8 text-center text-text-tertiary text-body">건의사항이 없습니다</div>
          )}
        </div>

        {/* 상세 */}
        <div className="bg-bg-primary border border-border-default rounded-lg p-6 sticky top-6">
          {selected ? (
            <div className="space-y-4">
              <div>
                <div className="text-caption text-text-tertiary mb-1">내용</div>
                <div className="text-body text-text-primary whitespace-pre-wrap bg-bg-secondary rounded p-3">
                  {selected.content}
                </div>
              </div>

              <div>
                <div className="text-caption text-text-tertiary mb-1">관리자 메모</div>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
                  placeholder="처리 내용을 기록하세요"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => updateStatus(selected.id, s.value)}
                    disabled={saving}
                    className={`px-3 py-1 text-[12px] rounded font-medium transition-colors ${
                      selected.status === s.value
                        ? s.color + " ring-1 ring-current"
                        : "bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => createDevRequest(selected)}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
              >
                <Bot size={14} /> AI 개발 요청
              </button>
            </div>
          ) : (
            <div className="text-center text-text-tertiary py-12 text-body">
              왼쪽에서 건의사항을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
