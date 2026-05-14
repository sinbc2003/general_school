"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Newspaper,
  ArrowLeft,
  ExternalLink,
  Send,
  StickyNote,
  Calendar,
} from "lucide-react";

interface Paper {
  id: number;
  title: string;
  authors?: string;
  abstract?: string;
  subject?: string;
  published_date?: string;
  url?: string;
  tags?: string[];
}

interface PaperDetail extends Paper {
  content?: string;
  doi?: string;
  journal_name?: string;
}

interface Note {
  id: number;
  content: string;
  created_at?: string;
}

export default function PapersPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedPaper, setSelectedPaper] = useState<PaperDetail | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pageSize = 10;

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(
        `/api/papers?page=${page}&page_size=${pageSize}&status=approved`
      );
      setPapers(data.items || data || []);
      setTotal(data.total || 0);
    } catch {
      setPapers([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  const openPaper = async (paper: Paper) => {
    setSelectedPaper(paper as PaperDetail);
    setNotes([]);
    setNewNote("");
    // Notes would be fetched from a notes endpoint if available
  };

  const addNote = async () => {
    if (!selectedPaper || !newNote.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/papers/${selectedPaper.id}/notes`, {
        content: newNote,
      });
      // Add to local state optimistically
      setNotes((prev) => [
        ...prev,
        {
          id: Date.now(),
          content: newNote,
          created_at: new Date().toISOString(),
        },
      ]);
      setNewNote("");
    } catch {
      alert("메모 저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Detail view
  if (selectedPaper) {
    return (
      <div>
        <button
          onClick={() => {
            setSelectedPaper(null);
            setNotes([]);
          }}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {selectedPaper.subject && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-cream-100 text-blue-600">
                {selectedPaper.subject}
              </span>
            )}
            {selectedPaper.journal_name && (
              <span className="text-[11px] text-text-tertiary">
                {selectedPaper.journal_name}
              </span>
            )}
          </div>
          <h1 className="text-title text-text-primary mb-2">
            {selectedPaper.title}
          </h1>
          {selectedPaper.authors && (
            <p className="text-caption text-text-secondary mb-2">
              {selectedPaper.authors}
            </p>
          )}
          {selectedPaper.published_date && (
            <div className="flex items-center gap-1 text-caption text-text-tertiary mb-3">
              <Calendar size={11} />
              {new Date(selectedPaper.published_date).toLocaleDateString(
                "ko-KR"
              )}
            </div>
          )}
          {selectedPaper.abstract && (
            <div className="pt-3 border-t border-border-default">
              <h3 className="text-caption font-semibold text-text-secondary mb-1">
                초록
              </h3>
              <p className="text-body text-text-primary whitespace-pre-wrap">
                {selectedPaper.abstract}
              </p>
            </div>
          )}
          {selectedPaper.content && (
            <div className="mt-3 pt-3 border-t border-border-default">
              <p className="text-body text-text-primary whitespace-pre-wrap">
                {selectedPaper.content}
              </p>
            </div>
          )}
          {selectedPaper.tags && selectedPaper.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border-default">
              {selectedPaper.tags.map((tag, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-secondary"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {(selectedPaper.url || selectedPaper.doi) && (
            <div className="mt-3 pt-3 border-t border-border-default">
              {selectedPaper.url && (
                <a
                  href={selectedPaper.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-caption text-accent"
                >
                  <ExternalLink size={12} />
                  원문 보기
                </a>
              )}
              {selectedPaper.doi && (
                <span className="text-caption text-text-tertiary block mt-1">
                  DOI: {selectedPaper.doi}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Personal Notes */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <h3 className="text-body font-semibold text-text-primary mb-3 flex items-center gap-1">
            <StickyNote size={16} />
            개인 메모
          </h3>

          {/* Existing Notes */}
          {notes.length > 0 && (
            <div className="space-y-2 mb-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="bg-bg-secondary rounded-lg p-3"
                >
                  <p className="text-body text-text-primary whitespace-pre-wrap">
                    {note.content}
                  </p>
                  {note.created_at && (
                    <span className="text-[11px] text-text-tertiary block mt-1">
                      {new Date(note.created_at).toLocaleString("ko-KR")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add Note */}
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={3}
            className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-secondary text-text-primary resize-none mb-2"
            placeholder="논문에 대한 메모를 남겨보세요."
          />
          <button
            onClick={addNote}
            disabled={submitting || !newNote.trim()}
            className="w-full py-2 bg-accent text-white rounded-lg text-caption font-medium disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <Send size={14} />
            {submitting ? "저장 중..." : "메모 저장"}
          </button>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">논문</h1>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-bg-primary rounded-lg border border-border-default p-4 animate-pulse"
            >
              <div className="h-5 bg-bg-secondary rounded w-3/4 mb-2" />
              <div className="h-3 bg-bg-secondary rounded w-1/2 mb-1" />
              <div className="h-3 bg-bg-secondary rounded w-full" />
            </div>
          ))}
        </div>
      ) : papers.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <Newspaper size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">
            승인된 논문이 없습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {papers.map((paper) => (
            <button
              key={paper.id}
              onClick={() => openPaper(paper)}
              className="w-full text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition"
            >
              {paper.subject && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-cream-100 text-blue-600 inline-block mb-1">
                  {paper.subject}
                </span>
              )}
              <h3 className="text-body font-medium text-text-primary mb-1 line-clamp-2">
                {paper.title}
              </h3>
              {paper.authors && (
                <p className="text-caption text-text-secondary mb-1">
                  {paper.authors}
                </p>
              )}
              {paper.abstract && (
                <p className="text-caption text-text-tertiary line-clamp-2">
                  {paper.abstract}
                </p>
              )}
              {paper.published_date && (
                <div className="flex items-center gap-1 text-[11px] text-text-tertiary mt-1">
                  <Calendar size={10} />
                  {new Date(paper.published_date).toLocaleDateString("ko-KR")}
                </div>
              )}
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
