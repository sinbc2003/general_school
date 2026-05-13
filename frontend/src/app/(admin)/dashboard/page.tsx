"use client";

import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import {
  Users,
  Shield,
  FileText,
  Activity,
  Briefcase,
  Target,
  Library,
  Sparkles,
  Trophy,
  ClipboardList,
  Users2,
  CalendarRange,
  GraduationCap,
} from "lucide-react";
import Link from "next/link";

interface CurrentSemester {
  id: number;
  year: number;
  semester: number;
  name: string;
}

export default function DashboardPage() {
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const isStudent = user?.role === "student";
  const isTeacher = user?.role === "teacher";

  if (isStudent) return <StudentDashboard />;
  if (isTeacher) return <TeacherDashboard />;
  return <AdminDashboard />;
}

// ── 학생 대시보드 ──

function StudentDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [sem, setSem] = useState<CurrentSemester | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get<CurrentSemester | null>("/api/timetable/semesters/current")
      .then(setSem).catch(() => {});
    // 학생 본인 통계 — 가벼운 dashboard 전용 엔드포인트
    api.get("/api/me/dashboard-stats").then(setStats).catch(() => setStats({}));
  }, [user]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title text-text-primary">{user?.name}님, 안녕하세요</h1>
        {sem && (
          <div className="text-caption text-text-tertiary mt-1 flex items-center gap-1">
            <CalendarRange size={12} /> {sem.name}
          </div>
        )}
      </div>

      {/* 빠른 진입 카드 — 학생용 핵심 4개 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <QuickCard href="/s/my-portfolio" icon={Briefcase} label="나의 포트폴리오" color="bg-blue-50 text-blue-600" />
        <QuickCard href="/s/career" icon={Target} label="진로/진학 설계" color="bg-emerald-50 text-emerald-600" />
        <QuickCard href="/s/research-archive" icon={Library} label="선배 연구 자료" color="bg-purple-50 text-purple-600" />
        <QuickCard href="/s/chat" icon={Sparkles} label="AI 도우미" color="bg-amber-50 text-amber-600" newTab />
      </div>

      {/* 본인 활동 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Trophy} label="수상" value={stats?.awards_count ?? "-"} color="text-status-success" />
        <StatCard icon={FileText} label="논문" value={stats?.theses_count ?? "-"} color="text-accent" />
        <StatCard icon={Users2} label="동아리 활동" value={stats?.club_activities ?? "-"} color="text-status-warning" />
        <StatCard icon={ClipboardList} label="과제 제출" value={stats?.assignments_submitted ?? "-"} color="text-purple-600" />
      </div>

      <div className="bg-bg-primary rounded-lg border border-border-default p-6">
        <h2 className="text-body font-semibold text-text-primary mb-2">학생 안내</h2>
        <p className="text-body text-text-secondary">
          좌측 메뉴에서 "나의 영역"의 포트폴리오/진로/선배 자료를 확인하고, 대회/과제/동아리에도 참여해보세요.
          AI 도우미는 학습 질문에 도움을 줄 수 있습니다.
        </p>
      </div>
    </div>
  );
}

// ── 교사 대시보드 ──

function TeacherDashboard() {
  const { user } = useAuth();
  const [sem, setSem] = useState<CurrentSemester | null>(null);
  const [myEnroll, setMyEnroll] = useState<any>(null);
  const [teacherStats, setTeacherStats] = useState<{ by_grade: Record<string, number>; total: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get<CurrentSemester | null>("/api/timetable/semesters/current")
      .then(setSem).catch(() => {});
    api.get("/api/timetable/my-enrollment").then((d) => setMyEnroll(d?.enrollment)).catch(() => {});
    api.get<{ by_grade: Record<string, number>; total: number }>("/api/timetable/teacher-dashboard-stats")
      .then(setTeacherStats).catch(() => {});
  }, [user]);

  const studentCount = teacherStats?.total ?? null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title text-text-primary">{user?.name} 선생님, 안녕하세요</h1>
        {sem && (
          <div className="text-caption text-text-tertiary mt-1 flex items-center gap-1">
            <CalendarRange size={12} /> {sem.name}
            {myEnroll?.department && <span className="ml-2">· {myEnroll.department}</span>}
            {myEnroll?.homeroom_class && <span className="ml-2">· {myEnroll.homeroom_class} 담임</span>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={GraduationCap}
          label="담당 학생"
          value={studentCount ?? "-"}
          color="text-accent"
          hint="현재 학기 정책 기준"
        />
        <StatCard
          icon={ClipboardList}
          label="수업 학년"
          value={(myEnroll?.teaching_grades || []).join(",") || "-"}
          color="text-status-success"
        />
        <StatCard
          icon={FileText}
          label="가르치는 과목"
          value={(myEnroll?.teaching_subjects || []).slice(0, 2).join(", ") || "-"}
          color="text-status-warning"
        />
        <StatCard
          icon={Activity}
          label="상태"
          value={myEnroll?.onboarded ? "정상" : "Onboarding 필요"}
          color={myEnroll?.onboarded ? "text-status-success" : "text-status-error"}
        />
      </div>

      {/* 담당 학생 학년별 분포 */}
      {teacherStats && teacherStats.total > 0 && (
        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-6">
          <h3 className="text-caption text-text-tertiary mb-3">담당 학생 학년별 분포</h3>
          <div className="flex items-end gap-3">
            {Object.entries(teacherStats.by_grade)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([grade, count]) => {
                const max = Math.max(...Object.values(teacherStats.by_grade));
                const heightPx = Math.max(8, Math.round((count / max) * 80));
                return (
                  <div key={grade} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-caption text-text-secondary">{count}</span>
                    <div
                      className="w-full bg-accent/70 rounded-t"
                      style={{ height: `${heightPx}px` }}
                    />
                    <span className="text-caption text-text-tertiary">{grade}학년</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <QuickCard href="/students" icon={Users} label="학생 관리" color="bg-blue-50 text-blue-600" />
        <QuickCard href="/contest" icon={Trophy} label="대회 관리" color="bg-amber-50 text-amber-600" />
        <QuickCard href="/assignment" icon={ClipboardList} label="과제 관리" color="bg-emerald-50 text-emerald-600" />
        <QuickCard href="/chat" icon={Sparkles} label="AI 챗봇" color="bg-purple-50 text-purple-600" newTab />
      </div>

      <div className="bg-bg-primary rounded-lg border border-border-default p-6">
        <h2 className="text-body font-semibold text-text-primary mb-2">교사 안내</h2>
        <p className="text-body text-text-secondary">
          좌측 메뉴에서 학생 관리, 대회/과제 등록, 협의록, 동아리·연구 프로젝트 관리를 수행할 수 있습니다.
          {myEnroll && !myEnroll.onboarded && (
            <> · <Link href="/auth/teacher-onboarding" className="text-accent underline">담당 정보 입력하기 →</Link></>
          )}
        </p>
      </div>
    </div>
  );
}

// ── 관리자 대시보드 (기존 유지) ──

function AdminDashboard() {
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [sem, setSem] = useState<CurrentSemester | null>(null);

  useEffect(() => {
    api.get("/api/users?per_page=1").then((data) => setStats({ totalUsers: data.total })).catch(() => {});
    api.get<CurrentSemester | null>("/api/timetable/semesters/current").then(setSem).catch(() => {});
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title text-text-primary">대시보드</h1>
        {sem && (
          <div className="text-caption text-text-tertiary mt-1 flex items-center gap-1">
            <CalendarRange size={12} /> {sem.name}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Users} label="전체 사용자" value={stats?.totalUsers ?? "-"} color="text-accent" />
        <StatCard icon={Shield} label="내 역할" value={user?.role === "super_admin" ? "최고관리자" : "지정관리자"} color="text-status-success" />
        <StatCard icon={FileText} label="플랫폼" value="v1.0.0" color="text-status-warning" />
        <StatCard icon={Activity} label="상태" value="정상" color="text-status-success" />
      </div>

      <div className="bg-bg-primary rounded-lg border border-border-default p-6">
        <h2 className="text-body font-semibold text-text-primary mb-3">안내</h2>
        <p className="text-body text-text-secondary">
          {isSuperAdmin
            ? "최고관리자로 로그인하셨습니다. 사용자 관리, 권한 관리, 시스템 설정을 수행할 수 있습니다."
            : "관리자 권한으로 로그인하셨습니다. 부여된 권한 범위 내에서 관리 기능을 사용할 수 있습니다."}
        </p>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, color, hint,
}: { icon: any; label: string; value: string | number; color: string; hint?: string }) {
  return (
    <div className="bg-bg-primary rounded-lg border border-border-default p-4">
      <div className="flex items-center gap-3">
        <div className={color}><Icon size={24} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-caption text-text-tertiary truncate">{label}</div>
          <div className="text-body font-semibold text-text-primary truncate">{value}</div>
          {hint && <div className="text-[11px] text-text-tertiary">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

function QuickCard({
  href, icon: Icon, label, color, newTab,
}: { href: string; icon: any; label: string; color: string; newTab?: boolean }) {
  const cls = `flex flex-col items-center justify-center gap-2 p-4 rounded-lg border border-border-default hover:shadow-sm transition-shadow ${color}`;
  if (newTab) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        <Icon size={24} />
        <span className="text-body font-medium">{label}</span>
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      <Icon size={24} />
      <span className="text-body font-medium">{label}</span>
    </Link>
  );
}
