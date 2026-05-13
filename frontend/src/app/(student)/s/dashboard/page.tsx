"use client";

import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { BookOpen, Flame, ClipboardList, Trophy, Calendar } from "lucide-react";
import Link from "next/link";

interface Assignment {
  id: number;
  title: string;
  due_date: string;
  status: string;
}

interface Contest {
  id: number;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [contests, setContests] = useState<Contest[]>([]);
  const [progress, setProgress] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [assignRes, contestRes, progressRes] = await Promise.allSettled([
          api.get("/api/assignment?page=1&page_size=5"),
          api.get("/api/contest?page=1&page_size=5"),
          api.get("/api/challenge/my-progress"),
        ]);
        if (assignRes.status === "fulfilled") {
          setAssignments(assignRes.value.items || assignRes.value || []);
        }
        if (contestRes.status === "fulfilled") {
          setContests(contestRes.value.items || contestRes.value || []);
        }
        if (progressRes.status === "fulfilled") {
          setProgress(progressRes.value || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const solvedCount = progress.filter((p) => p.status === "solved").length;
  const totalPoints = progress.reduce((sum: number, p: any) => sum + (p.score || 0), 0);
  const pendingAssignments = assignments.filter(
    (a) => a.status !== "completed" && a.status !== "graded"
  ).length;

  return (
    <div>
      {/* Welcome */}
      <h1 className="text-title text-text-primary mb-1">
        안녕하세요, {user?.name}님
      </h1>
      <p className="text-body text-text-secondary mb-6">
        {user?.grade ? `${user.grade}학년 ` : ""}
        {user?.class_number ? `${user.class_number}반 ` : ""}
        {user?.student_number ? `${user.student_number}번` : ""}
      </p>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard
          icon={BookOpen}
          label="풀이 진행"
          value={`${solvedCount}문제`}
          color="text-accent"
        />
        <StatCard
          icon={Flame}
          label="챌린지 포인트"
          value={`${totalPoints}점`}
          color="text-status-warning"
        />
        <StatCard
          icon={ClipboardList}
          label="과제 현황"
          value={`${pendingAssignments}건 남음`}
          color="text-status-error"
        />
        <StatCard
          icon={Trophy}
          label="대회"
          value={`${contests.length}개 예정`}
          color="text-status-success"
        />
      </div>

      {/* Upcoming Assignments */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-body font-semibold text-text-primary">다가오는 과제</h2>
          <Link href="/assignment" className="text-caption text-accent">
            전체보기
          </Link>
        </div>
        {loading ? (
          <LoadingSkeleton />
        ) : assignments.length === 0 ? (
          <EmptyCard message="등록된 과제가 없습니다." />
        ) : (
          <div className="space-y-2">
            {assignments.slice(0, 3).map((a) => (
              <Link
                key={a.id}
                href="/assignment"
                className="block bg-bg-primary rounded-lg border border-border-default p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-body text-text-primary font-medium truncate">
                    {a.title}
                  </span>
                  <StatusBadge status={a.status} />
                </div>
                {a.due_date && (
                  <div className="flex items-center gap-1 mt-1">
                    <Calendar size={12} className="text-text-tertiary" />
                    <span className="text-caption text-text-tertiary">
                      마감: {new Date(a.due_date).toLocaleDateString("ko-KR")}
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Upcoming Contests */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-body font-semibold text-text-primary">예정된 대회</h2>
          <Link href="/contest" className="text-caption text-accent">
            전체보기
          </Link>
        </div>
        {loading ? (
          <LoadingSkeleton />
        ) : contests.length === 0 ? (
          <EmptyCard message="예정된 대회가 없습니다." />
        ) : (
          <div className="space-y-2">
            {contests.slice(0, 3).map((c) => (
              <Link
                key={c.id}
                href="/contest"
                className="block bg-bg-primary rounded-lg border border-border-default p-3"
              >
                <span className="text-body text-text-primary font-medium">
                  {c.title}
                </span>
                {c.start_time && (
                  <div className="flex items-center gap-1 mt-1">
                    <Calendar size={12} className="text-text-tertiary" />
                    <span className="text-caption text-text-tertiary">
                      {new Date(c.start_time).toLocaleDateString("ko-KR")} ~{" "}
                      {c.end_time
                        ? new Date(c.end_time).toLocaleDateString("ko-KR")
                        : ""}
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-bg-primary rounded-lg border border-border-default p-3">
      <div className="flex items-center gap-2">
        <Icon size={18} className={color} />
        <div>
          <div className="text-caption text-text-tertiary">{label}</div>
          <div className="text-body font-semibold text-text-primary">{value}</div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    active: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    graded: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = {
    pending: "대기",
    active: "진행중",
    completed: "완료",
    graded: "채점완료",
    overdue: "기한초과",
  };
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full ${
        styles[status] || "bg-gray-100 text-gray-600"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="bg-bg-primary rounded-lg border border-border-default p-3 animate-pulse"
        >
          <div className="h-4 bg-bg-secondary rounded w-3/4 mb-2" />
          <div className="h-3 bg-bg-secondary rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="bg-bg-primary rounded-lg border border-border-default p-4 text-center">
      <p className="text-caption text-text-tertiary">{message}</p>
    </div>
  );
}
