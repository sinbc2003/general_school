"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  FlaskConical,
  ArrowLeft,
  Calendar,
  Plus,
  BookOpen,
  Send,
} from "lucide-react";

interface Research {
  id: number;
  title: string;
  description?: string;
  status?: string;
  subject?: string;
  mentor_name?: string;
  start_date?: string;
  end_date?: string;
}

interface ResearchDetail extends Research {
  content?: string;
  members?: string[];
}

interface Journal {
  id: number;
  content: string;
  week_number: number;
  created_at?: string;
  feedback?: string;
}

export default function ResearchPage() {
  const [projects, setProjects] = useState<Research[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ResearchDetail | null>(
    null
  );
  const [journals, setJournals] = useState<Journal[]>([]);
  const [showJournalForm, setShowJournalForm] = useState(false);
  const [journalContent, setJournalContent] = useState("");
  const [weekNumber, setWeekNumber] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const pageSize = 10;

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(
        `/api/research?page=${page}&page_size=${pageSize}`
      );
      setProjects(data.items || data || []);
      setTotal(data.total || 0);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const openProject = async (id: number) => {
    try {
      const [projectData, journalsData] = await Promise.all([
        api.get(`/api/research/${id}`),
        api.get(`/api/research/${id}/journals`),
      ]);
      setSelectedProject(projectData);
      const jList = journalsData?.items || journalsData || [];
      setJournals(jList);
      setWeekNumber(jList.length + 1);
      setShowJournalForm(false);
      setJournalContent("");
    } catch {
      alert("연구 정보를 불러올 수 없습니다.");
    }
  };

  const submitJournal = async () => {
    if (!selectedProject || !journalContent.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/research/${selectedProject.id}/journals`, {
        content: journalContent,
        week_number: weekNumber,
      });
      const journalsData = await api.get(
        `/api/research/${selectedProject.id}/journals`
      );
      const jList = journalsData?.items || journalsData || [];
      setJournals(jList);
      setJournalContent("");
      setWeekNumber(jList.length + 1);
      setShowJournalForm(false);
    } catch {
      alert("일지 저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusStyle = (status?: string) => {
    switch (status) {
      case "planning":
        return "bg-yellow-50 text-yellow-600";
      case "in_progress":
      case "active":
        return "bg-blue-50 text-blue-600";
      case "completed":
        return "bg-green-50 text-green-600";
      default:
        return "bg-gray-100 text-gray-500";
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case "planning":
        return "계획";
      case "in_progress":
      case "active":
        return "진행중";
      case "completed":
        return "완료";
      default:
        return status || "-";
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Detail view
  if (selectedProject) {
    return (
      <div>
        <button
          onClick={() => {
            setSelectedProject(null);
            setJournals([]);
          }}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            {selectedProject.subject && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                {selectedProject.subject}
              </span>
            )}
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${getStatusStyle(
                selectedProject.status
              )}`}
            >
              {getStatusLabel(selectedProject.status)}
            </span>
          </div>
          <h1 className="text-title text-text-primary mb-2">
            {selectedProject.title}
          </h1>
          {selectedProject.description && (
            <p className="text-body text-text-secondary mb-2">
              {selectedProject.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-caption text-text-tertiary">
            {selectedProject.mentor_name && (
              <span>지도교사: {selectedProject.mentor_name}</span>
            )}
            {selectedProject.start_date && (
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                {new Date(selectedProject.start_date).toLocaleDateString("ko-KR")}
                {selectedProject.end_date &&
                  ` ~ ${new Date(selectedProject.end_date).toLocaleDateString("ko-KR")}`}
              </span>
            )}
          </div>
        </div>

        {/* Journal Section */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-body font-semibold text-text-primary">
            연구일지 ({journals.length})
          </h2>
          <button
            onClick={() => setShowJournalForm(!showJournalForm)}
            className="flex items-center gap-1 text-caption text-accent"
          >
            <Plus size={14} />
            {showJournalForm ? "취소" : "일지 작성"}
          </button>
        </div>

        {/* Journal Form */}
        {showJournalForm && (
          <div className="bg-bg-primary rounded-lg border border-accent p-4 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <label className="text-caption text-text-secondary">주차</label>
              <input
                type="number"
                value={weekNumber}
                onChange={(e) => setWeekNumber(Number(e.target.value))}
                min={1}
                className="w-20 border border-border-default rounded px-2 py-1 text-caption bg-bg-primary text-text-primary"
              />
            </div>
            <textarea
              value={journalContent}
              onChange={(e) => setJournalContent(e.target.value)}
              rows={6}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-secondary text-text-primary resize-none mb-3"
              placeholder="이번 주 연구 활동 내용을 작성하세요."
            />
            <button
              onClick={submitJournal}
              disabled={submitting || !journalContent.trim()}
              className="w-full py-2 bg-accent text-white rounded-lg text-caption font-medium disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Send size={14} />
              {submitting ? "저장 중..." : "일지 저장"}
            </button>
          </div>
        )}

        {/* Journal List */}
        {journals.length === 0 ? (
          <div className="bg-bg-primary rounded-lg border border-border-default p-6 text-center">
            <BookOpen size={24} className="mx-auto text-text-tertiary mb-2" />
            <p className="text-caption text-text-tertiary">
              작성된 연구일지가 없습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {journals.map((j) => (
              <div
                key={j.id}
                className="bg-bg-primary rounded-lg border border-border-default p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-caption font-semibold text-accent">
                    {j.week_number}주차
                  </span>
                  {j.created_at && (
                    <span className="text-caption text-text-tertiary">
                      {new Date(j.created_at).toLocaleDateString("ko-KR")}
                    </span>
                  )}
                </div>
                <p className="text-body text-text-primary whitespace-pre-wrap">
                  {j.content}
                </p>
                {j.feedback && (
                  <div className="mt-3 pt-2 border-t border-border-default">
                    <span className="text-caption font-medium text-text-secondary">
                      피드백:
                    </span>
                    <p className="text-caption text-text-secondary mt-1">
                      {j.feedback}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">연구</h1>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-bg-primary rounded-lg border border-border-default p-4 animate-pulse"
            >
              <div className="h-5 bg-bg-secondary rounded w-2/3 mb-2" />
              <div className="h-3 bg-bg-secondary rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <FlaskConical size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">
            참여 중인 연구 프로젝트가 없습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((r) => (
            <button
              key={r.id}
              onClick={() => openProject(r.id)}
              className="w-full text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition"
            >
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-body font-medium text-text-primary">
                  {r.title}
                </h3>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${getStatusStyle(
                    r.status
                  )}`}
                >
                  {getStatusLabel(r.status)}
                </span>
              </div>
              {r.description && (
                <p className="text-caption text-text-secondary line-clamp-2 mb-1">
                  {r.description}
                </p>
              )}
              <div className="flex items-center gap-3 text-caption text-text-tertiary">
                {r.mentor_name && <span>지도: {r.mentor_name}</span>}
                {r.subject && <span>{r.subject}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded border border-border-default text-caption text-text-secondary disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded border border-border-default text-caption text-text-secondary disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
