"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, FileText, CheckCircle2, XCircle, AlertCircle, Download,
  ClipboardCheck, FlaskConical, Users, Eye,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";

interface ResearchPending {
  id: number;
  year: number;
  grade: number | null;
  semester: number | null;
  report_type: string | null;
  fields: string[];
  title: string;
  submitted_by_name: string | null;
  file_url: string;
  original_filename: string;
  created_at: string | null;
}

interface GroupPending {
  id: number;
  group_id: number;
  group_name: string;
  student_name: string;
  student_username: string;
  title: string;
  description: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string | null;
}

interface ClubPending {
  id: number;
  club_id: number;
  club_name: string;
  author_name: string;
  author_username: string;
  title: string;
  submission_type: string;
  file_path: string | null;
  created_at: string | null;
}

type Tab = "research" | "group" | "club";

export default function ResearchReviewPage() {
  const [tab, setTab] = useState<Tab>("research");
  const [research, setResearch] = useState<ResearchPending[]>([]);
  const [groups, setGroups] = useState<GroupPending[]>([]);
  const [clubs, setClubs] = useState<ClubPending[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, g, c] = await Promise.all([
      api.get("/api/past-research/_my/pending").catch(() => ({ items: [] })),
      api.get("/api/teacher-groups/_my/pending").catch(() => ({ items: [] })),
      api.get("/api/club/_my/pending-submissions").catch(() => ({ items: [] })),
    ]);
    setResearch(r.items || []);
    setGroups(g.items || []);
    setClubs(c.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const reviewResearch = async (id: number, status: "approved" | "rejected") => {
    let reason: string | null = null;
    if (status === "rejected") {
      reason = prompt("반려 사유를 입력하세요");
      if (reason === null) return;
    }
    try {
      await api.patch(`/api/past-research/${id}/_review`, { status, rejection_reason: reason });
      load();
    } catch (e: any) { alert(`처리 실패: ${e?.detail || e}`); }
  };

  const reviewGroup = async (id: number, status: "approved" | "rejected") => {
    let reason: string | null = null;
    if (status === "rejected") {
      reason = prompt("반려 사유를 입력하세요");
      if (reason === null) return;
    }
    try {
      await api.patch(`/api/teacher-groups/_submissions/${id}/_review`, { status, rejection_reason: reason });
      load();
    } catch (e: any) { alert(`처리 실패: ${e?.detail || e}`); }
  };

  const reviewClub = async (id: number, status: "approved" | "rejected") => {
    let reason: string | null = null;
    if (status === "rejected") {
      reason = prompt("반려 사유를 입력하세요");
      if (reason === null) return;
    }
    try {
      const qs = new URLSearchParams({ status });
      if (reason) qs.set("rejection_reason", reason);
      await api.patch(`/api/club/submissions/${id}/_review?${qs}`, {});
      load();
    } catch (e: any) { alert(`처리 실패: ${e?.detail || e}`); }
  };

  if (loading) return <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>;

  const total = research.length + groups.length + clubs.length;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-title text-text-primary">승인 대기함</h1>
        <p className="text-caption text-text-tertiary mt-1">
          본인이 담당 교사인 학생들의 산출물 — 승인 시 학생 산출물 갤러리에 자동 등록됩니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-border-default">
        <TabBtn active={tab === "research"} onClick={() => setTab("research")}
                icon={<FlaskConical size={14} />} label="연구 보고서" count={research.length} />
        <TabBtn active={tab === "group"} onClick={() => setTab("group")}
                icon={<Users size={14} />} label="행사/대회 산출물" count={groups.length} />
        <TabBtn active={tab === "club"} onClick={() => setTab("club")}
                icon={<ClipboardCheck size={14} />} label="동아리 산출물" count={clubs.length} />
      </div>

      {total === 0 && (
        <div className="p-8 text-center text-text-tertiary bg-bg-primary border border-border-default rounded-lg">
          <CheckCircle2 size={28} className="mx-auto mb-2 text-green-500" />
          <div className="text-body">모두 처리 완료</div>
          <div className="text-caption mt-1">담당 학생의 새 제출물이 오면 여기에 표시됩니다</div>
        </div>
      )}

      {tab === "research" && research.length > 0 && (
        <div className="space-y-2">
          {research.map((r) => (
            <Card key={`r${r.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-caption text-text-tertiary mb-1">
                    {r.submitted_by_name} · {r.year}년 {r.grade}학년 {r.semester}학기 · {r.report_type}
                  </div>
                  <div className="text-body text-text-primary font-medium mb-1">{r.title}</div>
                  <div className="flex flex-wrap gap-1">
                    {r.fields.map((f) => (
                      <span key={f} className="text-[10px] px-1.5 py-0.5 bg-cream-100 text-blue-700 rounded">{f}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => downloadSecure(r.file_url, r.original_filename)} className="px-2 py-1 text-caption border border-border-default rounded inline-flex items-center gap-1">
                    <Eye size={12} /> 보기
                  </button>
                </div>
              </div>
              <ReviewButtons onApprove={() => reviewResearch(r.id, "approved")} onReject={() => reviewResearch(r.id, "rejected")} />
            </Card>
          ))}
        </div>
      )}

      {tab === "group" && groups.length > 0 && (
        <div className="space-y-2">
          {groups.map((g) => (
            <Card key={`g${g.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-caption text-text-tertiary mb-1">
                    {g.student_name}({g.student_username}) · 그룹: {g.group_name}
                  </div>
                  <div className="text-body text-text-primary font-medium mb-1">{g.title}</div>
                  {g.description && <div className="text-caption text-text-secondary whitespace-pre-wrap">{g.description}</div>}
                </div>
                {g.file_url && (
                  <button onClick={() => downloadSecure(g.file_url!, g.file_name || undefined)} className="px-2 py-1 text-caption border border-border-default rounded inline-flex items-center gap-1">
                    <Eye size={12} /> 보기
                  </button>
                )}
              </div>
              <ReviewButtons onApprove={() => reviewGroup(g.id, "approved")} onReject={() => reviewGroup(g.id, "rejected")} />
            </Card>
          ))}
        </div>
      )}

      {tab === "club" && clubs.length > 0 && (
        <div className="space-y-2">
          {clubs.map((c) => (
            <Card key={`c${c.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-caption text-text-tertiary mb-1">
                    {c.author_name}({c.author_username}) · 동아리: {c.club_name}
                  </div>
                  <div className="text-body text-text-primary font-medium mb-1">{c.title}</div>
                  <div className="text-caption text-text-tertiary">{c.submission_type}</div>
                </div>
                {c.file_path && (
                  <button onClick={() => downloadSecure(c.file_path!, c.title)} className="px-2 py-1 text-caption border border-border-default rounded inline-flex items-center gap-1">
                    <Eye size={12} /> 보기
                  </button>
                )}
              </div>
              <ReviewButtons onApprove={() => reviewClub(c.id, "approved")} onReject={() => reviewClub(c.id, "rejected")} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-body inline-flex items-center gap-1 border-b-2 transition ${
        active ? "border-accent text-accent font-medium" : "border-transparent text-text-secondary hover:text-text-primary"
      }`}
    >
      {icon} {label}
      <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${count > 0 ? "bg-red-100 text-red-700" : "bg-bg-secondary text-text-tertiary"}`}>{count}</span>
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-bg-primary border border-border-default rounded-lg p-3">{children}</div>;
}

function ReviewButtons({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-default">
      <button onClick={onApprove} className="px-3 py-1 bg-green-600 text-white text-caption rounded inline-flex items-center gap-1">
        <CheckCircle2 size={12} /> 승인
      </button>
      <button onClick={onReject} className="px-3 py-1 bg-red-600 text-white text-caption rounded inline-flex items-center gap-1">
        <XCircle size={12} /> 반려
      </button>
    </div>
  );
}
