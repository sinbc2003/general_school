"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Users,
  X,
  ArrowLeft,
  Calendar,
  CalendarRange,
} from "lucide-react";
import { ClubAssignmentModal } from "@/components/admin/ClubAssignmentModal";

interface CurrentSemester {
  id: number;
  year: number;
  semester: number;
  name: string;
}

interface ClubItem {
  id: number;
  name: string;
  category: string;
  status: string;
  member_count: number;
}

interface Activity {
  id: number;
  title: string;
  activity_date: string;
  content: string;
  created_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  academic: "bg-blue-100 text-blue-700",
  sports: "bg-green-100 text-green-700",
  arts: "bg-purple-100 text-purple-700",
  volunteer: "bg-orange-100 text-orange-700",
  science: "bg-cyan-100 text-cyan-700",
  technology: "bg-indigo-100 text-indigo-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  academic: "학술",
  sports: "체육",
  arts: "예술",
  volunteer: "봉사",
  science: "과학",
  technology: "기술",
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: "활동중", className: "text-status-success" },
  inactive: { label: "비활동", className: "text-text-tertiary" },
  suspended: { label: "정지", className: "text-status-error" },
};

export default function ClubPage() {
  const [clubs, setClubs] = useState<ClubItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedClub, setSelectedClub] = useState<ClubItem | null>(null);
  const [currentSem, setCurrentSem] = useState<CurrentSemester | null>(null);

  useEffect(() => {
    api.get<CurrentSemester | null>("/api/timetable/semesters/current")
      .then(setCurrentSem).catch(() => {});
  }, []);
  const [form, setForm] = useState({ name: "", category: "academic", description: "", max_members: "30" });

  const pageSize = 12;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      const data = await api.get(`/api/club?${params}`);
      setClubs(data.items);
      setTotal(data.total);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    try {
      await api.post("/api/club", {
        ...form,
        max_members: Number(form.max_members),
      });
      setShowCreate(false);
      setForm({ name: "", category: "academic", description: "", max_members: "30" });
      fetchData();
    } catch (err: any) { alert(err?.detail || "생성 실패"); }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Activity detail view
  if (selectedClub) {
    return <ClubActivities club={selectedClub} onBack={() => setSelectedClub(null)} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title text-text-primary">동아리 관리</h1>
          {currentSem && (
            <div className="text-caption text-text-secondary mt-1 flex items-center gap-1">
              <CalendarRange size={12} />
              <span>{currentSem.name} 데이터만 표시됩니다.</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAssign(true)}
            className="flex items-center gap-1 px-3 py-2 border border-border-default text-text-primary text-body rounded hover:bg-bg-secondary"
            title="CSV로 학생 동아리 일괄 배정"
          >
            <Users size={14} /> 학생 일괄 배정
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1 px-4 py-2 bg-accent text-white text-body rounded hover:bg-accent-hover"
          >
            <Plus size={16} /> 동아리 생성
          </button>
        </div>
      </div>

      <ClubAssignmentModal
        show={showAssign}
        onClose={() => setShowAssign(false)}
        onApplied={fetchData}
      />

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 p-4 bg-bg-primary rounded-lg border border-border-default">
          <h3 className="text-body font-semibold text-text-primary mb-3">새 동아리</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="동아리 이름" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary">
              <option value="academic">학술</option>
              <option value="sports">체육</option>
              <option value="arts">예술</option>
              <option value="volunteer">봉사</option>
              <option value="science">과학</option>
              <option value="technology">기술</option>
            </select>
            <input type="number" value={form.max_members} onChange={(e) => setForm({ ...form, max_members: e.target.value })} placeholder="최대 인원" className="px-3 py-2 text-body border border-border-default rounded bg-bg-primary" />
          </div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="동아리 설명" rows={3} className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary resize-none mb-3" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-1.5 bg-accent text-white text-body rounded hover:bg-accent-hover">생성</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-border-default text-body rounded hover:bg-bg-secondary">취소</button>
          </div>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clubs.map((club) => {
          const status = STATUS_CONFIG[club.status] || { label: club.status, className: "text-text-tertiary" };
          const catColor = CATEGORY_COLORS[club.category] || "bg-gray-100 text-gray-700";
          const catLabel = CATEGORY_LABELS[club.category] || club.category;

          return (
            <button
              key={club.id}
              onClick={() => setSelectedClub(club)}
              className="text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-body font-semibold text-text-primary group-hover:text-accent transition-colors">
                  {club.name}
                </h3>
                <span className={`inline-block px-2 py-0.5 text-caption rounded ${catColor}`}>
                  {catLabel}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-1 text-caption text-text-tertiary">
                  <Users size={14} />
                  <span>{club.member_count}명</span>
                </div>
                <span className={`text-caption font-medium ${status.className}`}>
                  {status.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {clubs.length === 0 && (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center text-body text-text-tertiary">
          {loading ? "로딩 중..." : "동아리가 없습니다"}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <span className="text-caption text-text-secondary">{page} / {totalPages} ({total}개)</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Club Activities View ──
function ClubActivities({ club, onBack }: { club: ClubItem; onBack: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/api/club/${club.id}/activities`)
      .then((d) => setActivities(Array.isArray(d) ? d : []))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, [club.id]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1.5 hover:bg-bg-secondary rounded transition-colors">
          <ArrowLeft size={20} className="text-text-tertiary" />
        </button>
        <div>
          <h1 className="text-title text-text-primary">{club.name}</h1>
          <p className="text-caption text-text-tertiary">
            {CATEGORY_LABELS[club.category] || club.category} | {club.member_count}명
          </p>
        </div>
      </div>

      <h2 className="text-body font-semibold text-text-primary mb-3">활동 기록</h2>

      <div className="space-y-3">
        {activities.map((act) => (
          <div key={act.id} className="bg-bg-primary rounded-lg border border-border-default p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-body font-medium text-text-primary">{act.title}</h3>
              <span className="flex items-center gap-1 text-caption text-text-tertiary">
                <Calendar size={12} /> {act.activity_date}
              </span>
            </div>
            <p className="text-body text-text-secondary whitespace-pre-wrap">{act.content}</p>
          </div>
        ))}
        {activities.length === 0 && (
          <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center text-body text-text-tertiary">
            {loading ? "로딩 중..." : "활동 기록이 없습니다"}
          </div>
        )}
      </div>
    </div>
  );
}
