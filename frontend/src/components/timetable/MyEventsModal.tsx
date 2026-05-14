"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Edit3, X, Save, Calendar } from "lucide-react";
import { api } from "@/lib/api/client";

interface MyEvent {
  id: number;
  day_of_week: number;
  period: number;
  subject: string;
  class_name: string;
  room: string | null;
  entry_type: "class" | "meeting" | "consultation" | "event" | "other";
  note: string | null;
}

const DAYS = ["월", "화", "수", "목", "금"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

const TYPE_LABELS: Record<string, string> = {
  class: "수업",
  meeting: "회의",
  consultation: "면담",
  event: "행사",
  other: "기타",
};

const TYPE_COLORS: Record<string, string> = {
  class: "bg-bg-secondary text-text-secondary border-border-default",
  meeting: "bg-purple-50 text-purple-700 border-purple-200",
  consultation: "bg-orange-50 text-orange-700 border-orange-200",
  event: "bg-pink-50 text-pink-700 border-pink-200",
  other: "bg-gray-50 text-gray-700 border-gray-200",
};

interface Props {
  show: boolean;
  onClose: () => void;
  semesterId: number | null;
}

const EMPTY_FORM = {
  day_of_week: 0,
  period: 1,
  entry_type: "meeting" as MyEvent["entry_type"],
  subject: "",
  room: "",
  note: "",
};

export function MyEventsModal({ show, onClose, semesterId }: Props) {
  const [items, setItems] = useState<MyEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = semesterId ? `?semester_id=${semesterId}` : "";
      const data = await api.get(`/api/timetable/my-events${q}`);
      setItems(data.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [semesterId]);

  useEffect(() => {
    if (show) load();
  }, [show, load]);

  if (!show) return null;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (e: MyEvent) => {
    setForm({
      day_of_week: e.day_of_week,
      period: e.period,
      entry_type: e.entry_type === "class" ? "meeting" : e.entry_type,
      subject: e.subject,
      room: e.room || "",
      note: e.note || "",
    });
    setEditingId(e.id);
  };

  const save = async () => {
    if (!form.subject.trim()) {
      alert("제목을 입력하세요");
      return;
    }
    setSaving(true);
    try {
      const body: any = { ...form, semester_id: semesterId };
      if (editingId) {
        await api.put(`/api/timetable/my-events/${editingId}`, body);
      } else {
        await api.post("/api/timetable/my-events", body);
      }
      resetForm();
      await load();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: MyEvent) => {
    if (!confirm(`"${e.subject}" 일정을 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/timetable/my-events/${e.id}`);
      await load();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  // 본인 일정만 분리 (수업 외)
  const personal = items.filter((e) => e.entry_type !== "class");
  const classes = items.filter((e) => e.entry_type === "class");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-title text-text-primary flex items-center gap-2">
              <Calendar size={18} className="text-accent" /> 내 개인 일정
            </h2>
            <p className="text-caption text-text-tertiary mt-0.5">
              회의 / 면담 / 행사 등 본인 일정만. 수업은 관리자가 등록한 시간표에서 자동 표시.
            </p>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">✕</button>
        </div>

        {/* 등록 폼 */}
        <div className="bg-bg-secondary rounded-lg p-3 mb-4">
          <div className="grid grid-cols-12 gap-2 items-center mb-2">
            <select
              value={form.day_of_week}
              onChange={(e) => setForm({ ...form, day_of_week: Number(e.target.value) })}
              className="col-span-2 px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <select
              value={form.period}
              onChange={(e) => setForm({ ...form, period: Number(e.target.value) })}
              className="col-span-2 px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              {PERIODS.map((p) => <option key={p} value={p}>{p}교시</option>)}
            </select>
            <select
              value={form.entry_type}
              onChange={(e) => setForm({ ...form, entry_type: e.target.value as MyEvent["entry_type"] })}
              className="col-span-2 px-2 py-1.5 text-body border border-border-default rounded bg-bg-primary"
            >
              <option value="meeting">회의</option>
              <option value="consultation">면담</option>
              <option value="event">행사</option>
              <option value="other">기타</option>
            </select>
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="제목"
              className="col-span-4 px-2 py-1.5 text-body border border-border-default rounded"
            />
            <input
              value={form.room}
              onChange={(e) => setForm({ ...form, room: e.target.value })}
              placeholder="장소 (선택)"
              className="col-span-2 px-2 py-1.5 text-body border border-border-default rounded"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="메모 (선택)"
              className="flex-1 px-2 py-1.5 text-body border border-border-default rounded"
            />
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-body rounded disabled:opacity-50"
            >
              {editingId ? <><Save size={13} /> 수정 저장</> : <><Plus size={13} /> 추가</>}
            </button>
            {editingId && (
              <button onClick={resetForm} className="px-3 py-1.5 border border-border-default text-body rounded">
                취소
              </button>
            )}
          </div>
        </div>

        {/* 본인 개인 일정 리스트 */}
        <div className="mb-4">
          <h3 className="text-body font-semibold text-text-primary mb-2">
            내 개인 일정 ({personal.length})
          </h3>
          {loading ? (
            <div className="text-text-tertiary">로딩 중...</div>
          ) : personal.length === 0 ? (
            <div className="text-caption text-text-tertiary py-4 text-center bg-bg-secondary rounded">
              등록된 개인 일정이 없습니다
            </div>
          ) : (
            <div className="space-y-1">
              {personal.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded border ${TYPE_COLORS[e.entry_type]}`}
                >
                  <span className="text-caption font-medium w-16">
                    {DAYS[e.day_of_week]} {e.period}교시
                  </span>
                  <span className="text-caption px-2 py-0.5 rounded bg-white/50">
                    {TYPE_LABELS[e.entry_type]}
                  </span>
                  <span className="text-body font-medium flex-1 truncate">{e.subject}</span>
                  {e.room && <span className="text-caption opacity-75">@{e.room}</span>}
                  <button onClick={() => startEdit(e)} className="p-1 opacity-60 hover:opacity-100" title="수정">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => remove(e)} className="p-1 opacity-60 hover:opacity-100 hover:text-status-error" title="삭제">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 본인 수업 (read-only 참고) */}
        {classes.length > 0 && (
          <div>
            <h3 className="text-body font-semibold text-text-primary mb-2">
              내 수업 (자동 — 관리자만 편집)
            </h3>
            <div className="grid grid-cols-2 gap-1">
              {classes.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-bg-secondary text-text-secondary text-caption"
                >
                  <span className="w-14">{DAYS[e.day_of_week]} {e.period}교시</span>
                  <span className="flex-1 truncate">{e.subject}</span>
                  <span className="opacity-70">{e.class_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
