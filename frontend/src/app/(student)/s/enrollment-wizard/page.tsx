"use client";

/**
 * 학생 수강과목 마법사 — 첫 학기 시작 시 또는 학기 전환 시.
 *
 * - 본인 학기 enrollment 확인 (학급 단위 강좌는 자동 등록 표시)
 * - 선택과목 후보 list에서 체크박스로 선택
 * - "완료" 시 POST /subjects + POST /complete → onboarded=True
 * - 완료 후 폴더 자동 동기화됨 (백엔드 hook)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, BookOpen, GraduationCap, AlertCircle } from "lucide-react";
import { api } from "@/lib/api/client";

interface StatusResp {
  semester: { id: number; year: number; semester: number; name: string } | null;
  onboarded: boolean;
  has_enrollment_record: boolean;
  enrolled_courses_count: number;
  grade: number | null;
  class_number: number | null;
}

interface CourseBrief {
  id: number;
  name: string;
  subject: string;
  class_name: string | null;
  course_type: string;
  grade_level: number | null;
}

export default function EnrollmentWizardPage() {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [enrolled, setEnrolled] = useState<CourseBrief[]>([]);
  const [candidates, setCandidates] = useState<CourseBrief[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, av] = await Promise.all([
          api.get<StatusResp>("/api/me/enrollment/status"),
          api.get<{ already_enrolled: CourseBrief[]; candidates: CourseBrief[] }>(
            "/api/me/enrollment/available-courses"
          ),
        ]);
        setStatus(s);
        setEnrolled(av.already_enrolled);
        setCandidates(av.candidates);
      } catch (e: any) {
        setError(e?.detail || e?.message || "정보를 불러오지 못했습니다");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const togglePick = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (picked.size > 0) {
        await api.post("/api/me/enrollment/subjects", {
          course_ids: Array.from(picked),
        });
      }
      await api.post("/api/me/enrollment/complete", {});
      router.push("/s/drive");
    } catch (e: any) {
      setError(e?.detail || e?.message || "등록 실패");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-text-tertiary">불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <GraduationCap className="text-accent" />
          수강과목 마법사
        </h1>
        <p className="text-[13px] text-text-tertiary mt-2">
          {status?.semester
            ? `${status.semester.year}학년도 ${status.semester.semester}학기 — 본인이 듣는 과목을 선택하세요.`
            : "현재 학기가 설정되지 않았습니다."}
        </p>
        {status && status.grade != null && status.class_number != null && (
          <p className="text-[12px] text-text-secondary mt-1">
            {status.grade}학년 {status.class_number}반
          </p>
        )}
      </div>

      {status?.onboarded && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded bg-emerald-50 border border-emerald-200">
          <Check size={16} className="text-emerald-600 mt-0.5" />
          <div className="text-[13px] text-emerald-900">
            이미 이번 학기 수강과목 등록을 완료했습니다. 변경 시 다시 선택하고 완료를 누르세요.
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded bg-red-50 border border-red-200">
          <AlertCircle size={16} className="text-red-600 mt-0.5" />
          <div className="text-[13px] text-red-900">{error}</div>
        </div>
      )}

      {/* 자동 등록 */}
      <div className="mb-6 bg-bg-primary border border-border-default rounded-lg p-4">
        <h2 className="text-[15px] font-semibold text-text-primary mb-2 flex items-center gap-2">
          <BookOpen size={16} className="text-accent" />
          자동 등록된 수업 ({enrolled.length})
        </h2>
        <p className="text-[12px] text-text-tertiary mb-3">
          학급 단위 수업은 자동으로 등록됩니다.
        </p>
        {enrolled.length === 0 ? (
          <div className="text-[13px] text-text-tertiary py-2">아직 자동 등록된 수업이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {enrolled.map((c) => (
              <div
                key={c.id}
                className="px-3 py-2 rounded border border-emerald-200 bg-emerald-50 text-[13px]"
              >
                <div className="font-medium text-text-primary">{c.name}</div>
                <div className="text-[11px] text-text-tertiary mt-0.5">
                  {c.subject} · {c.class_name ?? "선택과목"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 선택과목 후보 */}
      <div className="mb-6 bg-bg-primary border border-border-default rounded-lg p-4">
        <h2 className="text-[15px] font-semibold text-text-primary mb-2 flex items-center gap-2">
          <BookOpen size={16} className="text-accent" />
          선택과목 ({picked.size}개 선택 / 전체 {candidates.length})
        </h2>
        <p className="text-[12px] text-text-tertiary mb-3">
          본인이 듣는 선택과목만 체크하세요. 추후 수정 가능합니다.
        </p>
        {candidates.length === 0 ? (
          <div className="text-[13px] text-text-tertiary py-2">
            현재 학년에 등록 가능한 선택과목 후보가 없습니다. 관리자에게 문의하세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {candidates.map((c) => {
              const isPicked = picked.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`px-3 py-2 rounded border cursor-pointer flex items-start gap-2 text-[13px] ${
                    isPicked
                      ? "border-accent bg-accent/10"
                      : "border-border-default hover:bg-bg-secondary"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => togglePick(c.id)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <div className="font-medium text-text-primary">{c.name}</div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">
                      {c.subject}
                      {c.grade_level != null && ` · ${c.grade_level}학년 대상`}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/s/drive")}
          className="px-4 py-2 text-[13px] text-text-secondary hover:bg-bg-secondary rounded"
        >
          나중에 (드라이브로)
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="px-5 py-2 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "등록 중..." : "수강 신청 완료"}
        </button>
      </div>
    </div>
  );
}
