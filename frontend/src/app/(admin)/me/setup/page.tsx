"use client";

import { useCallback, useEffect, useState } from "react";
import {
  User as UserIcon, GraduationCap, BookOpen, FlaskConical,
  Loader2, Save, CheckCircle2, X, Plus, Trash2, Search,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface Me {
  id: number;
  name: string;
  email: string;
  username: string;
  role: string;
  phone: string | null;
  department: string | null;
}

interface Semester {
  id: number;
  name: string;
  is_current: boolean;
}

interface MyEnrollment {
  homeroom_class: string | null;
  subhomeroom_class: string | null;
  teaching_grades: string[];
  teaching_classes: string[];
  teaching_subjects: string[];
  semester?: Semester;
}

interface SupervisedStudent {
  id: number;
  student_id: number;
  student_name: string;
  student_username: string;
  grade: number | null;
  topic_title: string | null;
}

export default function TeacherMeSetupPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [enrollment, setEnrollment] = useState<MyEnrollment | null>(null);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  const [supervised, setSupervised] = useState<SupervisedStudent[]>([]);
  const [loading, setLoading] = useState(true);

  // 본인 정보 폼
  const [phone, setPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // enrollment 폼
  const [homeroom, setHomeroom] = useState("");
  const [subhomeroom, setSubhomeroom] = useState("");
  const [teachingGradesStr, setTeachingGradesStr] = useState("");
  const [teachingClassesStr, setTeachingClassesStr] = useState("");
  const [teachingSubjectsStr, setTeachingSubjectsStr] = useState("");
  const [savingEnroll, setSavingEnroll] = useState(false);

  // 연구 학생 검색·추가
  const [studentSearch, setStudentSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [topicTitle, setTopicTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, en, sup] = await Promise.all([
        api.get("/api/auth/me"),
        api.get("/api/timetable/my-enrollment").catch(() => null),
        api.get("/api/past-research/_my/supervised-students").catch(() => ({ items: [], semester_id: null })),
      ]);
      setMe(m);
      setPhone(m.phone || "");
      if (en) {
        setEnrollment({
          homeroom_class: en.homeroom_class,
          subhomeroom_class: en.subhomeroom_class,
          teaching_grades: en.teaching_grades || [],
          teaching_classes: en.teaching_classes || [],
          teaching_subjects: en.teaching_subjects || [],
          semester: en.semester,
        });
        setHomeroom(en.homeroom_class || "");
        setSubhomeroom(en.subhomeroom_class || "");
        setTeachingGradesStr((en.teaching_grades || []).join(", "));
        setTeachingClassesStr((en.teaching_classes || []).join(", "));
        setTeachingSubjectsStr((en.teaching_subjects || []).join(", "));
      }
      setSemesterId(sup.semester_id);
      setSupervised(sup.items || []);
    } catch (e: any) {
      alert(`로딩 실패: ${e?.detail || e}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      // 전화는 enrollment onboarding에 포함해서 저장
      await api.put("/api/timetable/my-enrollment/onboarding", { phone });
      alert("저장됨 ✓");
      await load();
    } catch (e: any) {
      alert(`저장 실패: ${e?.detail || e}`);
    } finally { setSavingProfile(false); }
  };

  const saveEnrollment = async () => {
    setSavingEnroll(true);
    try {
      const splitList = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      await api.put("/api/timetable/my-enrollment/onboarding", {
        homeroom_class: homeroom.trim() || null,
        subhomeroom_class: subhomeroom.trim() || null,
        teaching_grades: splitList(teachingGradesStr),
        teaching_classes: splitList(teachingClassesStr),
        teaching_subjects: splitList(teachingSubjectsStr),
      });
      alert("저장됨 ✓");
      await load();
    } catch (e: any) {
      alert(`저장 실패: ${e?.detail || e}`);
    } finally { setSavingEnroll(false); }
  };

  const searchStudents = async (q: string) => {
    setStudentSearch(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const d = await api.get(`/api/teacher-groups/_students/_search?q=${encodeURIComponent(q)}`);
      setSearchResults(d.items || []);
    } catch {}
  };

  const addSupervised = async (student_id: number) => {
    if (!semesterId) { alert("현재 학기 정보가 없습니다"); return; }
    if (!me) return;
    try {
      await api.post("/api/past-research/_supervisions", {
        semester_id: semesterId,
        student_id,
        supervisor_id: me.id,
        topic_title: topicTitle.trim() || null,
      });
      setStudentSearch(""); setSearchResults([]); setTopicTitle("");
      await load();
    } catch (e: any) {
      alert(`추가 실패: ${e?.detail || e}`);
    }
  };

  const removeSupervised = async (sid: number) => {
    if (!confirm("연구 담당 매핑을 해제하시겠습니까?")) return;
    try {
      await api.delete(`/api/past-research/_supervisions/${sid}`);
      await load();
    } catch (e: any) { alert(`해제 실패: ${e?.detail || e}`); }
  };

  if (loading) return <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-title text-text-primary">내 정보 등록</h1>
        <p className="text-caption text-text-tertiary mt-1">
          최고관리자가 셋업 마법사에서 선택 단계를 건너뛴 경우, 본인 정보를 여기서 등록하세요. 저장 즉시 반영됩니다.
        </p>
      </div>

      {/* 섹션 1: 본인 정보 */}
      <Section icon={<UserIcon size={16} />} title="1. 본인 정보">
        <div className="grid grid-cols-2 gap-3">
          <Field label="이름" value={me?.name || ""} readOnly />
          <Field label="이메일" value={me?.email || ""} readOnly />
          <Field label="아이디" value={me?.username || ""} readOnly />
          <Field label="부서" value={me?.department || "—"} readOnly />
          <Field
            label="전화번호"
            value={phone}
            onChange={(v) => setPhone(v)}
            placeholder="010-1234-5678"
          />
        </div>
        <p className="text-caption text-text-tertiary mt-2">
          이름·이메일·부서는 관리자만 수정 가능. 변경 요청은 관리자에게.
        </p>
        <div className="flex justify-end mt-3">
          <button onClick={saveProfile} disabled={savingProfile}
                  className="px-3 py-1.5 bg-accent text-white text-caption rounded inline-flex items-center gap-1 disabled:opacity-50">
            {savingProfile ? <><Loader2 size={12} className="animate-spin" /> 저장 중</> : <><Save size={12} /> 전화번호 저장</>}
          </button>
        </div>
      </Section>

      {/* 섹션 2,3: 담임 + 담당 과목 (한 번에 onboarding endpoint로 저장) */}
      <Section icon={<GraduationCap size={16} />} title="2. 담임·담당 학급" subtitle={enrollment?.semester ? `${enrollment.semester.name} 기준` : ""}>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="담임 (예: 1-3)"
            value={homeroom}
            onChange={setHomeroom}
            placeholder="비워두면 미담임"
          />
          <Field
            label="부담임 (예: 2-1)"
            value={subhomeroom}
            onChange={setSubhomeroom}
          />
        </div>
      </Section>

      <Section icon={<BookOpen size={16} />} title="3. 담당 과목·수업 학급" subtitle="쉼표·공백으로 구분">
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="수업 학년"
            value={teachingGradesStr}
            onChange={setTeachingGradesStr}
            placeholder="1, 2"
          />
          <Field
            label="수업 학급"
            value={teachingClassesStr}
            onChange={setTeachingClassesStr}
            placeholder="1-1, 1-3, 2-2"
          />
          <Field
            label="담당 과목"
            value={teachingSubjectsStr}
            onChange={setTeachingSubjectsStr}
            placeholder="수학, 미적분"
          />
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={saveEnrollment} disabled={savingEnroll}
                  className="px-3 py-1.5 bg-accent text-white text-caption rounded inline-flex items-center gap-1 disabled:opacity-50">
            {savingEnroll ? <><Loader2 size={12} className="animate-spin" /> 저장 중</> : <><Save size={12} /> 담임·과목 저장</>}
          </button>
        </div>
      </Section>

      {/* 섹션 4: 연구 담당 학생 */}
      <Section icon={<FlaskConical size={16} />} title="4. 연구 담당 학생" subtitle="본인이 연구 보고서를 검토할 학생을 직접 추가">
        {supervised.length > 0 ? (
          <div className="space-y-1 mb-3">
            {supervised.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-2 py-1.5 bg-bg-secondary rounded">
                <div className="text-caption">
                  <span className="text-text-primary">{s.student_name}</span>
                  <span className="text-text-tertiary ml-1">({s.student_username})</span>
                  {s.grade && <span className="text-text-tertiary ml-1">· {s.grade}학년</span>}
                  {s.topic_title && <span className="text-text-tertiary ml-2">· {s.topic_title}</span>}
                </div>
                <button onClick={() => removeSupervised(s.id)} className="text-red-500 hover:text-red-700">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-caption text-text-tertiary mb-3">아직 담당 학생이 없습니다</p>
        )}

        <div className="space-y-2">
          <div className="relative">
            <div className="flex gap-1">
              <input value={studentSearch} onChange={(e) => searchStudents(e.target.value)}
                     placeholder="학번 또는 이름 검색"
                     className="flex-1 px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary" />
            </div>
            {searchResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-bg-primary border border-border-default rounded shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map((s) => (
                  <button key={s.id} onClick={() => addSupervised(s.id)}
                          className="w-full text-left px-2 py-1.5 hover:bg-bg-secondary text-caption flex items-center justify-between">
                    <span>{s.name} <span className="text-text-tertiary">({s.username})</span></span>
                    {s.grade && <span className="text-text-tertiary text-[10px]">{s.grade}학년</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)}
                 placeholder="연구 주제 (선택, 학생 추가 시 같이 저장)"
                 className="w-full px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary" />
        </div>
      </Section>

      <div className="text-center text-caption text-text-tertiary pt-2">
        ✓ 모든 변경은 저장 즉시 DB에 반영됩니다 — 나중에 사이드바 메뉴에서도 수정 가능
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

function Field({ label, value, onChange, placeholder, readOnly }: {
  label: string; value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-caption text-text-tertiary">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full mt-0.5 px-2 py-1.5 border border-border-default rounded text-body bg-bg-primary ${readOnly ? "text-text-tertiary" : ""}`}
      />
    </label>
  );
}
