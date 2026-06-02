"use client";

import { useCallback, useEffect, useState } from "react";
import {
  User as UserIcon, GraduationCap, BookOpen, FlaskConical,
  Loader2, Save, CheckCircle2, X, Plus, Trash2, Search,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { StudentPickerModal, type StudentRow } from "@/components/StudentPickerModal";

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
  is_current?: boolean;
  // 학교 구조 (드롭다운 소스) — _semester_to_dict 제공
  classes_per_grade?: Record<string, number>;
  subjects?: string[];
}

interface MyEnrollment {
  homeroom_class: string | null;
  subhomeroom_class: string | null;
  teaching_grades: (string | number)[];
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

  // enrollment 폼 — 학교 구조 기반 선택 (직접입력 X)
  const [homeroom, setHomeroom] = useState("");
  const [subhomeroom, setSubhomeroom] = useState("");
  const [grades, setGrades] = useState<Set<string>>(new Set());
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [subjects, setSubjects] = useState<Set<string>>(new Set());
  const [savingEnroll, setSavingEnroll] = useState(false);

  // 연구 학생 추가 — 명단에서 선택 (직접입력 X)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentRow | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [addingSup, setAddingSup] = useState(false);

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
        setGrades(new Set((en.teaching_grades || []).map(String)));
        setClasses(new Set(en.teaching_classes || []));
        setSubjects(new Set(en.teaching_subjects || []));
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
      await api.put("/api/timetable/my-enrollment/onboarding", {
        homeroom_class: homeroom || null,
        subhomeroom_class: subhomeroom || null,
        teaching_grades: Array.from(grades).map((g) => parseInt(g)),
        teaching_classes: Array.from(classes),
        teaching_subjects: Array.from(subjects),
      });
      alert("저장됨 ✓");
      await load();
    } catch (e: any) {
      alert(`저장 실패: ${e?.detail || e}`);
    } finally { setSavingEnroll(false); }
  };

  // 학교 구조 → 드롭다운 소스 (teacher-onboarding 페이지와 동일 규칙)
  const sem = enrollment?.semester;
  const allGrades = Object.keys(sem?.classes_per_grade || {}).sort();
  const allClasses: string[] = Object.entries(sem?.classes_per_grade || {})
    .flatMap(([g, n]) => Array.from({ length: n }, (_, i) => `${g}-${i + 1}`));
  const allSubjects = sem?.subjects || [];
  const toggleSet = (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFn(next);
  };

  const addSupervised = async () => {
    if (!selectedStudent) return;
    if (!semesterId) { alert("현재 학기 정보가 없습니다"); return; }
    if (!me) return;
    setAddingSup(true);
    try {
      await api.post("/api/past-research/_supervisions", {
        semester_id: semesterId,
        student_id: selectedStudent.id,
        supervisor_id: me.id,
        topic_title: topicTitle.trim() || null,
      });
      setSelectedStudent(null); setTopicTitle("");
      await load();
    } catch (e: any) {
      alert(`추가 실패: ${e?.detail || e}`);
    } finally { setAddingSup(false); }
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

      {/* 섹션 2: 담임·부담임 — 학교 구조 기반 드롭다운 (직접입력 X) */}
      <Section icon={<GraduationCap size={16} />} title="2. 담임·부담임 학급" subtitle={sem ? `${sem.name} 기준` : ""}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-caption text-text-tertiary">담임 학급</span>
            <select value={homeroom} onChange={(e) => setHomeroom(e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 border border-border-default rounded text-body bg-bg-primary">
              <option value="">담임 아님</option>
              {allClasses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-caption text-text-tertiary">부담임 학급</span>
            <select value={subhomeroom} onChange={(e) => setSubhomeroom(e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 border border-border-default rounded text-body bg-bg-primary">
              <option value="">부담임 아님</option>
              {allClasses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {allClasses.length === 0 && (
          <p className="text-caption text-text-tertiary mt-2">학교 구조(학급)가 설정되지 않았습니다. 관리자에게 요청하세요.</p>
        )}
      </Section>

      {/* 섹션 3: 수업 학년·학급·담당 과목 — 학교 구조에서 복수 선택 */}
      <Section icon={<BookOpen size={16} />} title="3. 담당 과목·수업 학급" subtitle="학교 구조에서 선택">
        {/* 수업 학년 */}
        <div className="mb-3">
          <span className="text-caption text-text-tertiary block mb-1.5">수업 학년 (복수 선택)</span>
          <div className="flex flex-wrap gap-2">
            {allGrades.map((g) => (
              <label key={g} className={`px-3 py-1.5 text-caption border rounded cursor-pointer transition-colors ${
                grades.has(g) ? "border-accent bg-accent/10 text-accent" : "border-border-default hover:bg-bg-secondary"}`}>
                <input type="checkbox" checked={grades.has(g)} onChange={() => toggleSet(grades, setGrades, g)} className="hidden" />
                {g}학년
              </label>
            ))}
            {allGrades.length === 0 && <span className="text-caption text-text-tertiary">학교 구조 미설정 — 관리자에게 요청</span>}
          </div>
        </div>

        {/* 수업 학급 (학년 선택 시 활성) */}
        <div className="mb-3">
          <span className="text-caption text-text-tertiary block mb-1.5">
            수업 학급 <span className="text-text-tertiary">(선택, 더 세밀히 지정할 때만)</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {allClasses.map((c) => {
              const enabledByGrade = grades.has(c.split("-")[0]);
              const checked = classes.has(c);
              return (
                <label key={c}
                  className={`px-2 py-0.5 text-caption border rounded cursor-pointer transition-colors ${
                    checked ? "border-accent bg-accent/10 text-accent"
                      : enabledByGrade ? "border-border-default hover:bg-bg-secondary" : "border-border-default opacity-40"}`}
                  title={!enabledByGrade ? "해당 학년을 먼저 선택" : ""}>
                  <input type="checkbox" checked={checked} disabled={!enabledByGrade}
                         onChange={() => toggleSet(classes, setClasses, c)} className="hidden" />
                  {c}
                </label>
              );
            })}
          </div>
        </div>

        {/* 담당 과목 */}
        <div>
          <span className="text-caption text-text-tertiary block mb-1.5">담당 과목 (복수 선택)</span>
          <div className="flex flex-wrap gap-1.5">
            {allSubjects.map((s) => (
              <label key={s} className={`px-3 py-1 text-caption border rounded cursor-pointer transition-colors ${
                subjects.has(s) ? "border-accent bg-accent/10 text-accent" : "border-border-default hover:bg-bg-secondary"}`}>
                <input type="checkbox" checked={subjects.has(s)} onChange={() => toggleSet(subjects, setSubjects, s)} className="hidden" />
                {s}
              </label>
            ))}
            {allSubjects.length === 0 && <span className="text-caption text-text-tertiary">개설 과목 미설정 — 관리자에게 요청</span>}
          </div>
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
          {selectedStudent ? (
            <div className="flex items-center justify-between px-2 py-1.5 bg-bg-secondary rounded">
              <span className="text-caption text-text-primary">
                {selectedStudent.name}
                {selectedStudent.grade && selectedStudent.class_number && selectedStudent.student_number && (
                  <span className="text-text-tertiary ml-2">
                    {selectedStudent.grade}{String(selectedStudent.class_number).padStart(2, "0")}{String(selectedStudent.student_number).padStart(2, "0")}
                  </span>
                )}
                {selectedStudent.username && <span className="text-text-tertiary ml-2">({selectedStudent.username})</span>}
              </span>
              <button onClick={() => setSelectedStudent(null)} className="text-text-tertiary hover:text-text-primary">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setPickerOpen(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-dashed border-border-default rounded text-caption text-text-secondary hover:bg-bg-secondary">
              <Search size={13} /> 학생 명단에서 찾기
            </button>
          )}
          <input value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)}
                 placeholder="연구 주제 (선택, 학생 추가 시 같이 저장)"
                 className="w-full px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary" />
          <div className="flex justify-end">
            <button onClick={addSupervised} disabled={!selectedStudent || addingSup}
                    className="px-3 py-1.5 bg-accent text-white text-caption rounded inline-flex items-center gap-1 disabled:opacity-50">
              {addingSup ? <><Loader2 size={12} className="animate-spin" /> 추가 중</> : <><Plus size={12} /> 담당 학생 추가</>}
            </button>
          </div>
        </div>

        <StudentPickerModal
          open={pickerOpen}
          mode="single"
          onClose={() => setPickerOpen(false)}
          title="담당 학생 선택"
          excludedUserIds={supervised.map((s) => s.student_id)}
          onPick={(stu) => setSelectedStudent(stu)}
        />
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
