"use client";

/**
 * 교사 첫 로그인 onboarding 페이지
 *
 * 트리거: AuthProvider가 교사 + 본인 enrollment.onboarded=False 감지 시 강제 redirect.
 * 내용: 학교 구조(학년·학급·과목·부서) 드롭다운으로 본인 정보 입력 → onboarded=True.
 * 저장 후: 본래 흐름(/dashboard) 재개.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, AlertCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

interface SemesterStructure {
  id: number;
  name: string;
  classes_per_grade: Record<string, number>;
  subjects: string[];
  departments: string[];
}

interface MyEnrollment {
  id: number;
  semester_id: number;
  role: string;
  homeroom_class: string | null;
  subhomeroom_class: string | null;
  teaching_grades: (string | number)[];
  teaching_classes: string[];
  teaching_subjects: string[];
  phone: string | null;
  onboarded: boolean;
}

export default function TeacherOnboardingPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [semester, setSemester] = useState<SemesterStructure | null>(null);
  const [enrollment, setEnrollment] = useState<MyEnrollment | null>(null);

  // 폼 상태
  const [homeroom, setHomeroom] = useState("");
  const [subhomeroom, setSubhomeroom] = useState("");
  const [grades, setGrades] = useState<Set<string>>(new Set());
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [subjects, setSubjects] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // 초기 fetch
  useEffect(() => {
    if (!user) return;
    api
      .get<{ enrollment: MyEnrollment | null; semester: SemesterStructure }>(
        "/api/timetable/my-enrollment",
      )
      .then((d) => {
        setSemester(d.semester);
        setEnrollment(d.enrollment);
        if (d.enrollment) {
          setHomeroom(d.enrollment.homeroom_class || "");
          setSubhomeroom(d.enrollment.subhomeroom_class || "");
          setGrades(new Set(d.enrollment.teaching_grades?.map(String) || []));
          setClasses(new Set(d.enrollment.teaching_classes || []));
          setSubjects(new Set(d.enrollment.teaching_subjects || []));
          setPhone(d.enrollment.phone || "");
        }
      })
      .catch((err) => setError(err?.detail || "정보 조회 실패"))
      .finally(() => setLoading(false));
  }, [user]);

  // 학년 토글
  const toggleSet = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFn(next);
  };

  // 사용 가능한 학급 목록 (학교 구조 기반)
  const allClasses: string[] = semester
    ? Object.entries(semester.classes_per_grade || {})
        .flatMap(([g, n]) =>
          Array.from({ length: n }, (_, i) => `${g}-${i + 1}`),
        )
    : [];

  const submit = async () => {
    if (!semester) return;
    setError("");
    setSaving(true);
    try {
      await api.put("/api/timetable/my-enrollment/onboarding", {
        semester_id: semester.id,
        homeroom_class: homeroom || null,
        subhomeroom_class: subhomeroom || null,
        teaching_grades: Array.from(grades).map((g) => parseInt(g)),
        teaching_classes: Array.from(classes),
        teaching_subjects: Array.from(subjects),
        phone: phone || null,
      });
      await refreshUser();
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary text-text-secondary">
        로딩 중...
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary p-4">
        <div className="w-full max-w-md bg-bg-primary rounded-lg shadow-lg p-8 text-center">
          <AlertCircle size={36} className="mx-auto text-status-warning mb-3" />
          <h1 className="text-title text-text-primary mb-2">학기 명단에 없습니다</h1>
          <p className="text-body text-text-secondary mb-4">
            관리자가 아직 {semester?.name || "현재 학기"} 명단에 본인을 등록하지 않았습니다.
            관리자에게 요청해주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-secondary p-4 py-8">
      <div className="max-w-2xl mx-auto bg-bg-primary rounded-lg shadow-lg p-8">
        <div className="text-center mb-6">
          <GraduationCap size={36} className="mx-auto text-accent mb-2" />
          <h1 className="text-title text-text-primary">교사 정보 입력</h1>
          <p className="text-caption text-text-tertiary mt-1">
            {semester?.name} · 첫 로그인 시 본인의 담당 정보를 입력해주세요.
            <br />이 정보는 "담당 학생만 보기" 같은 정책에 사용됩니다.
          </p>
        </div>

        <div className="space-y-5">
          {/* 전화번호 (선택) */}
          <section>
            <label className="block text-caption text-text-secondary mb-1">전화번호</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-1234-5678"
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
            />
          </section>

          {/* 담임/부담임 */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption text-text-secondary mb-1">담임 학급</label>
              <select
                value={homeroom}
                onChange={(e) => setHomeroom(e.target.value)}
                className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
              >
                <option value="">담임 아님</option>
                {allClasses.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">부담임 학급</label>
              <select
                value={subhomeroom}
                onChange={(e) => setSubhomeroom(e.target.value)}
                className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
              >
                <option value="">부담임 아님</option>
                {allClasses.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </section>

          {/* 수업 학년 (체크박스) */}
          <section>
            <label className="block text-caption text-text-secondary mb-2">수업하는 학년 (복수 선택)</label>
            <div className="flex flex-wrap gap-2">
              {Object.keys(semester?.classes_per_grade || {}).sort().map((g) => (
                <label
                  key={g}
                  className={`flex items-center gap-1 px-3 py-1.5 text-body border rounded cursor-pointer transition-colors ${
                    grades.has(g)
                      ? "border-accent bg-blue-50 text-accent"
                      : "border-border-default hover:bg-bg-secondary"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={grades.has(g)}
                    onChange={() => toggleSet(grades, setGrades, g)}
                    className="hidden"
                  />
                  {g}학년
                </label>
              ))}
            </div>
          </section>

          {/* 수업 학급 — 상세 (선택, 학년만 작성해도 됨) */}
          <section>
            <label className="block text-caption text-text-secondary mb-1">
              수업 학급 <span className="text-text-tertiary">(선택, 더 세밀히 지정할 때만)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {allClasses.map((c) => {
                const gradeOfClass = c.split("-")[0];
                const enabledByGrade = grades.has(gradeOfClass);
                const checked = classes.has(c);
                return (
                  <label
                    key={c}
                    className={`px-2 py-0.5 text-caption border rounded cursor-pointer transition-colors ${
                      checked
                        ? "border-accent bg-blue-50 text-accent"
                        : enabledByGrade
                        ? "border-border-default hover:bg-bg-secondary"
                        : "border-border-default opacity-40"
                    }`}
                    title={!enabledByGrade ? "해당 학년을 먼저 선택" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!enabledByGrade}
                      onChange={() => toggleSet(classes, setClasses, c)}
                      className="hidden"
                    />
                    {c}
                  </label>
                );
              })}
            </div>
            {allClasses.length === 0 && (
              <div className="text-caption text-text-tertiary">
                학교 구조가 설정되지 않았습니다. 관리자에게 요청하세요.
              </div>
            )}
          </section>

          {/* 가르치는 과목 */}
          <section>
            <label className="block text-caption text-text-secondary mb-2">가르치는 과목 (복수 선택)</label>
            <div className="flex flex-wrap gap-1.5">
              {(semester?.subjects || []).map((s) => (
                <label
                  key={s}
                  className={`px-3 py-1 text-body border rounded cursor-pointer transition-colors ${
                    subjects.has(s)
                      ? "border-accent bg-blue-50 text-accent"
                      : "border-border-default hover:bg-bg-secondary"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={subjects.has(s)}
                    onChange={() => toggleSet(subjects, setSubjects, s)}
                    className="hidden"
                  />
                  {s}
                </label>
              ))}
            </div>
            {(semester?.subjects || []).length === 0 && (
              <div className="text-caption text-text-tertiary">
                개설 과목이 설정되지 않았습니다. 관리자에게 요청하세요.
              </div>
            )}
          </section>

          {error && (
            <div className="text-caption text-status-error bg-red-50 p-2 rounded">{error}</div>
          )}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full py-2.5 bg-accent text-white rounded font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "저장 중..." : "저장하고 시작"}
          </button>
        </div>
      </div>
    </div>
  );
}
