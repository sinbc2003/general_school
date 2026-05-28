"use client";

import { useCallback, useEffect, useState } from "react";
import {
  User as UserIcon, GraduationCap, BookOpen, Users2, FlaskConical,
  Loader2, ExternalLink, CheckCircle2, AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";

interface Me {
  id: number;
  name: string;
  email: string;
  username: string;
  role: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  phone: string | null;
}

interface SupervisorInfo {
  supervisor: { id: number; name: string; topic_title: string | null } | null;
  semester_id: number | null;
}

interface EnrollmentStatus {
  onboarded: boolean;
  enrollment?: any;
  auto_enrolled_courses?: any[];
  enrolled_subjects?: any[];
}

export default function StudentMeSetupPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [supervisor, setSupervisor] = useState<SupervisorInfo | null>(null);
  const [enrollStatus, setEnrollStatus] = useState<EnrollmentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, sup, es] = await Promise.all([
        api.get("/api/auth/me"),
        api.get("/api/past-research/_my/supervisor").catch(() => ({ supervisor: null, semester_id: null })),
        api.get("/api/me/enrollment/status").catch(() => null),
      ]);
      setMe(m);
      setSupervisor(sup);
      setEnrollStatus(es);
    } catch (e: any) {
      alert(`로딩 실패: ${e?.detail || e}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>;

  const enrolledCount = (enrollStatus?.enrolled_subjects?.length || 0);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-title text-text-primary">내 정보 확인 및 등록</h1>
        <p className="text-caption text-text-tertiary mt-1">
          본인 정보를 확인하고 수강과목·동아리 등 직접 등록할 수 있는 항목을 안내합니다.
        </p>
      </div>

      {/* 본인 정보 (read-only, admin이 등록한 정보) */}
      <Section icon={<UserIcon size={16} />} title="1. 본인 정보">
        <div className="grid grid-cols-2 gap-3">
          <Field label="이름" value={me?.name || ""} />
          <Field label="이메일" value={me?.email || ""} />
          <Field label="학번" value={me?.username || ""} />
          <Field label="학년·반·번호" value={
            (me?.grade && me?.class_number && me?.student_number)
              ? `${me.grade}학년 ${me.class_number}반 ${me.student_number}번`
              : "미등록 (담임 또는 관리자에게 요청)"
          } />
        </div>
        <p className="text-caption text-text-tertiary mt-2">
          이 정보는 관리자가 등록·수정합니다. 잘못된 정보면 담임 또는 관리자에게 요청하세요.
        </p>
      </Section>

      {/* 수강과목 */}
      <Section icon={<BookOpen size={16} />} title="2. 수강과목 신청"
               subtitle={enrolledCount > 0 ? `현재 ${enrolledCount}개 선택과목 등록됨` : "아직 미등록"}>
        {enrollStatus?.onboarded ? (
          <p className="text-caption inline-flex items-center gap-1 text-green-700 mb-2">
            <CheckCircle2 size={12} /> 수강과목 신청 완료
          </p>
        ) : (
          <p className="text-caption inline-flex items-center gap-1 text-amber-700 mb-2">
            <AlertCircle size={12} /> 학기 시작 전 수강과목을 신청하세요
          </p>
        )}
        <Link href="/s/enrollment-wizard"
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-caption rounded">
          수강과목 신청 페이지 열기 <ExternalLink size={12} />
        </Link>
      </Section>

      {/* 동아리 */}
      <Section icon={<Users2 size={16} />} title="3. 동아리 가입"
               subtitle="동아리는 담당 교사 또는 관리자가 일괄 등록 — 추가 신청은 동아리 담당 교사에게">
        <Link href="/s/club"
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-border-default text-text-secondary text-caption rounded hover:bg-bg-secondary">
          내 동아리 보기 <ExternalLink size={12} />
        </Link>
      </Section>

      {/* 연구 담당교사 */}
      <Section icon={<FlaskConical size={16} />} title="4. 연구 담당교사">
        {supervisor?.supervisor ? (
          <div className="p-3 bg-bg-secondary rounded">
            <p className="text-body text-text-primary">
              <span className="text-text-tertiary">담당 교사:</span> {supervisor.supervisor.name} 선생님
            </p>
            {supervisor.supervisor.topic_title && (
              <p className="text-caption text-text-tertiary mt-1">주제: {supervisor.supervisor.topic_title}</p>
            )}
            <Link href="/s/research-submit" className="mt-2 inline-flex items-center gap-1 text-caption text-accent hover:underline">
              연구 보고서 제출 페이지 <ExternalLink size={11} />
            </Link>
          </div>
        ) : (
          <p className="text-caption inline-flex items-center gap-1 text-amber-700">
            <AlertCircle size={12} /> 담당 교사가 지정되지 않았습니다. 연구를 시작할 교사에게 본인을 담당으로 등록해달라고 요청하세요.
          </p>
        )}
      </Section>

      <div className="text-center text-caption text-text-tertiary pt-2">
        ✓ 수강과목 등 본인 등록 가능한 항목은 저장 즉시 반영됩니다
      </div>
    </div>
  );
}

function Section({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent">{icon}</span>
        <h3 className="text-body font-semibold text-text-primary">{title}</h3>
        {subtitle && <span className="text-caption text-text-tertiary">— {subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption text-text-tertiary">{label}</div>
      <div className="mt-0.5 px-2 py-1.5 border border-border-default rounded text-body bg-bg-secondary text-text-secondary">
        {value || "—"}
      </div>
    </div>
  );
}
