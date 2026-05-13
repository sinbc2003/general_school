"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Users2, ArrowLeft, Calendar, FileText } from "lucide-react";

interface Club {
  id: number;
  name: string;
  description?: string;
  category?: string;
  advisor_name?: string;
  member_count?: number;
}

interface Activity {
  id: number;
  title: string;
  content?: string;
  activity_date?: string;
  type?: string;
  created_at?: string;
}

export default function ClubPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);

  const pageSize = 10;

  const fetchClubs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(
        `/api/club?page=${page}&page_size=${pageSize}`
      );
      setClubs(data.items || data || []);
      setTotal(data.total || 0);
    } catch {
      setClubs([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchClubs();
  }, [fetchClubs]);

  const openClub = async (club: Club) => {
    setSelectedClub(club);
    try {
      const data = await api.get(`/api/club/${club.id}/activities`);
      setActivities(data?.items || data || []);
    } catch {
      setActivities([]);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Detail view
  if (selectedClub) {
    return (
      <div>
        <button
          onClick={() => {
            setSelectedClub(null);
            setActivities([]);
          }}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <h1 className="text-title text-text-primary mb-2">
            {selectedClub.name}
          </h1>
          {selectedClub.description && (
            <p className="text-body text-text-secondary mb-2">
              {selectedClub.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-caption text-text-tertiary">
            {selectedClub.category && (
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[11px]">
                {selectedClub.category}
              </span>
            )}
            {selectedClub.advisor_name && (
              <span>지도교사: {selectedClub.advisor_name}</span>
            )}
            {selectedClub.member_count != null && (
              <span>부원 {selectedClub.member_count}명</span>
            )}
          </div>
        </div>

        {/* Activities */}
        <h2 className="text-body font-semibold text-text-primary mb-3">
          활동 기록 ({activities.length})
        </h2>
        {activities.length === 0 ? (
          <div className="bg-bg-primary rounded-lg border border-border-default p-6 text-center">
            <FileText size={24} className="mx-auto text-text-tertiary mb-2" />
            <p className="text-caption text-text-tertiary">
              활동 기록이 없습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map((a) => (
              <div
                key={a.id}
                className="bg-bg-primary rounded-lg border border-border-default p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-body font-medium text-text-primary">
                    {a.title}
                  </h3>
                  {a.type && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex-shrink-0 ml-2">
                      {a.type}
                    </span>
                  )}
                </div>
                {a.content && (
                  <p className="text-body text-text-secondary whitespace-pre-wrap mb-2">
                    {a.content}
                  </p>
                )}
                {(a.activity_date || a.created_at) && (
                  <div className="flex items-center gap-1 text-caption text-text-tertiary">
                    <Calendar size={11} />
                    {new Date(
                      a.activity_date || a.created_at!
                    ).toLocaleDateString("ko-KR")}
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
      <h1 className="text-title text-text-primary mb-4">동아리</h1>

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
      ) : clubs.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <Users2 size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">
            소속된 동아리가 없습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {clubs.map((club) => (
            <button
              key={club.id}
              onClick={() => openClub(club)}
              className="w-full text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition"
            >
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-body font-medium text-text-primary">
                  {club.name}
                </h3>
                {club.category && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 flex-shrink-0 ml-2">
                    {club.category}
                  </span>
                )}
              </div>
              {club.description && (
                <p className="text-caption text-text-secondary line-clamp-2 mb-1">
                  {club.description}
                </p>
              )}
              <div className="flex items-center gap-3 text-caption text-text-tertiary">
                {club.advisor_name && (
                  <span>지도: {club.advisor_name}</span>
                )}
                {club.member_count != null && (
                  <span>부원 {club.member_count}명</span>
                )}
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
