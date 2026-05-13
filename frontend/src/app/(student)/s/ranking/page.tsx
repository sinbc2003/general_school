"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import { BarChart3, Trophy, Medal, Star } from "lucide-react";

interface Progress {
  problem_id: number;
  status: string;
  score: number;
  solved_at: string;
}

// Mock leaderboard data (replace with real API when available)
const MOCK_LEADERBOARD = [
  { rank: 1, name: "김**", points: 2450, solved: 89 },
  { rank: 2, name: "이**", points: 2280, solved: 82 },
  { rank: 3, name: "박**", points: 2100, solved: 75 },
  { rank: 4, name: "최**", points: 1950, solved: 71 },
  { rank: 5, name: "정**", points: 1800, solved: 65 },
  { rank: 6, name: "한**", points: 1650, solved: 60 },
  { rank: 7, name: "조**", points: 1500, solved: 55 },
  { rank: 8, name: "윤**", points: 1350, solved: 48 },
  { rank: 9, name: "장**", points: 1200, solved: 42 },
  { rank: 10, name: "임**", points: 1050, solved: 38 },
];

export default function RankingPage() {
  const { user } = useAuth();
  const [progress, setProgress] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get("/api/challenge/my-progress");
        setProgress(data || []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const solvedCount = progress.filter((p) => p.status === "solved").length;
  const totalPoints = progress.reduce(
    (sum, p) => sum + (p.score || 0),
    0
  );

  // Determine user's mock rank
  const myRank =
    MOCK_LEADERBOARD.findIndex((l) => l.points <= totalPoints) + 1 || MOCK_LEADERBOARD.length + 1;

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy size={18} className="text-yellow-500" />;
      case 2:
        return <Medal size={18} className="text-gray-400" />;
      case 3:
        return <Medal size={18} className="text-amber-600" />;
      default:
        return (
          <span className="w-[18px] h-[18px] flex items-center justify-center text-caption font-semibold text-text-tertiary">
            {rank}
          </span>
        );
    }
  };

  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">랭킹</h1>

      {/* My Stats */}
      <div className="bg-bg-primary rounded-lg border border-accent p-4 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Star size={20} className="text-accent" />
          </div>
          <div>
            <h2 className="text-body font-semibold text-text-primary">
              {user?.name || "나"}
            </h2>
            <p className="text-caption text-text-tertiary">
              {user?.grade ? `${user.grade}학년 ` : ""}
              {user?.class_number ? `${user.class_number}반` : ""}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-title font-bold text-accent">{myRank}</div>
            <div className="text-caption text-text-tertiary">순위</div>
          </div>
          <div className="text-center">
            <div className="text-title font-bold text-text-primary">
              {loading ? "-" : totalPoints}
            </div>
            <div className="text-caption text-text-tertiary">포인트</div>
          </div>
          <div className="text-center">
            <div className="text-title font-bold text-text-primary">
              {loading ? "-" : solvedCount}
            </div>
            <div className="text-caption text-text-tertiary">풀이</div>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <h2 className="text-body font-semibold text-text-primary mb-3">
        TOP 10
      </h2>
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        {MOCK_LEADERBOARD.map((entry, idx) => (
          <div
            key={entry.rank}
            className={`flex items-center gap-3 px-4 py-3 ${
              idx < MOCK_LEADERBOARD.length - 1
                ? "border-b border-border-default"
                : ""
            } ${entry.rank <= 3 ? "bg-yellow-50/50" : ""}`}
          >
            <div className="w-8 flex justify-center">
              {getRankIcon(entry.rank)}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-body text-text-primary font-medium">
                {entry.name}
              </span>
            </div>
            <div className="text-right">
              <div className="text-body font-semibold text-text-primary">
                {entry.points.toLocaleString()}점
              </div>
              <div className="text-[11px] text-text-tertiary">
                {entry.solved}문제
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Notice */}
      <div className="mt-4 bg-bg-primary rounded-lg border border-border-default p-4">
        <div className="flex items-start gap-2">
          <BarChart3 size={16} className="text-text-tertiary flex-shrink-0 mt-0.5" />
          <p className="text-caption text-text-tertiary">
            랭킹은 챌린지 포인트 기준으로 산정됩니다. 문제를 풀고 포인트를
            획득하여 순위를 올려보세요.
          </p>
        </div>
      </div>
    </div>
  );
}
