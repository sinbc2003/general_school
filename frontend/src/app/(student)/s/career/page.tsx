"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Target, GraduationCap, X, CalendarRange } from "lucide-react";
import { api } from "@/lib/api/client";

interface UnivTarget {
  university: string;
  major: string;
  admission_type: string;
  priority: number;
}

interface SemesterGoal {
  semester: string;
  goal: string;
}

interface CareerPlan {
  id?: number;
  year: number;
  semester_id?: number | null;
  desired_field: string | null;
  career_goal: string | null;
  target_universities: UnivTarget[];
  target_majors: string[];
  academic_plan: string | null;
  activity_plan: string | null;
  semester_goals: SemesterGoal[];
  motivation: string | null;
  notes: string | null;
  updated_at?: string | null;
}

interface ActiveSemester {
  id: number;
  year: number;
  semester: number;
  name: string;
}

const EMPTY_PLAN: CareerPlan = {
  year: new Date().getFullYear(),
  desired_field: "", career_goal: "",
  target_universities: [],
  target_majors: [],
  academic_plan: "", activity_plan: "",
  semester_goals: [],
  motivation: "", notes: "",
};

export default function CareerPlanPage() {
  const [semester, setSemester] = useState<ActiveSemester | null>(null);
  const [plan, setPlan] = useState<CareerPlan>(EMPTY_PLAN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/career-plans/active");
      setSemester(data.semester || null);
      if (data.plan) {
        setPlan({ ...EMPTY_PLAN, ...data.plan });
        setSavedAt(data.plan.updated_at || null);
      } else {
        setPlan({ ...EMPTY_PLAN, year: data.semester?.year || new Date().getFullYear() });
        setSavedAt(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.put("/api/me/career-plans/active", plan);
      setPlan((prev) => ({ ...prev, id: result.id, semester_id: result.semester_id }));
      setSavedAt(result.updated_at || new Date().toISOString());
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof CareerPlan, value: any) => {
    setPlan((prev) => ({ ...prev, [field]: value }));
  };

  const addUniv = () => {
    setPlan((prev) => ({
      ...prev,
      target_universities: [
        ...prev.target_universities,
        { university: "", major: "", admission_type: "수시", priority: prev.target_universities.length + 1 },
      ],
    }));
  };
  const updateUniv = (idx: number, field: keyof UnivTarget, value: any) => {
    setPlan((prev) => {
      const next = [...prev.target_universities];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, target_universities: next };
    });
  };
  const removeUniv = (idx: number) => {
    setPlan((prev) => ({
      ...prev,
      target_universities: prev.target_universities.filter((_, i) => i !== idx),
    }));
  };

  const addSemGoal = () => {
    setPlan((prev) => ({
      ...prev,
      semester_goals: [...prev.semester_goals, { semester: "", goal: "" }],
    }));
  };
  const updateSemGoal = (idx: number, field: keyof SemesterGoal, value: string) => {
    setPlan((prev) => {
      const next = [...prev.semester_goals];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, semester_goals: next };
    });
  };
  const removeSemGoal = (idx: number) => {
    setPlan((prev) => ({
      ...prev,
      semester_goals: prev.semester_goals.filter((_, i) => i !== idx),
    }));
  };

  if (loading) {
    return <div className="text-text-tertiary">로딩 중...</div>;
  }

  if (!semester) {
    return (
      <div>
        <h1 className="text-title text-text-primary mb-2">진로/진학 설계</h1>
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg p-8 text-center">
          <CalendarRange size={28} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-secondary">현재 학기가 설정되지 않았습니다</div>
          <div className="text-caption text-text-tertiary mt-1">
            관리자가 학기를 활성화하면 작성할 수 있어요.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">진로/진학 설계</h1>
          <p className="text-caption text-text-tertiary mt-0.5 flex items-center gap-1">
            <CalendarRange size={12} />
            <span><b>{semester.name}</b> · 학기당 1개의 계획. 학기 중에 언제든 수정 가능.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-caption text-text-tertiary">
              저장됨 {savedAt.replace("T", " ").slice(0, 16)}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50"
          >
            <Save size={14} /> {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5 space-y-5">
        {/* 진로 방향 */}
        <Section title="1. 진로 방향" icon={Target}>
          <FormField label="희망 진로 분야">
            <input
              value={plan.desired_field || ""}
              onChange={(e) => updateField("desired_field", e.target.value)}
              placeholder="예: 컴퓨터공학, 의학, 인문학..."
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </FormField>
          <FormField label="장래 희망 / 직업">
            <textarea
              value={plan.career_goal || ""}
              onChange={(e) => updateField("career_goal", e.target.value)}
              placeholder="구체적으로 어떤 일을 하고 싶은지"
              rows={2}
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </FormField>
        </Section>

        {/* 진학 목표 */}
        <Section title="2. 진학 목표 (희망 대학·학과)" icon={GraduationCap}>
          <div className="space-y-2">
            {plan.target_universities.map((u, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input
                  value={u.university}
                  onChange={(e) => updateUniv(idx, "university", e.target.value)}
                  placeholder="대학명"
                  className="col-span-3 px-2 py-1.5 border border-border-default rounded text-body"
                />
                <input
                  value={u.major}
                  onChange={(e) => updateUniv(idx, "major", e.target.value)}
                  placeholder="학과"
                  className="col-span-4 px-2 py-1.5 border border-border-default rounded text-body"
                />
                <select
                  value={u.admission_type}
                  onChange={(e) => updateUniv(idx, "admission_type", e.target.value)}
                  className="col-span-2 px-2 py-1.5 border border-border-default rounded text-body"
                >
                  <option>수시</option>
                  <option>정시</option>
                  <option>학종</option>
                  <option>교과</option>
                  <option>논술</option>
                  <option>실기</option>
                </select>
                <input
                  type="number"
                  value={u.priority}
                  onChange={(e) => updateUniv(idx, "priority", parseInt(e.target.value) || 1)}
                  placeholder="순위"
                  className="col-span-2 px-2 py-1.5 border border-border-default rounded text-body"
                />
                <button onClick={() => removeUniv(idx)} className="col-span-1 text-status-error">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button onClick={addUniv}
                    className="flex items-center gap-1 text-caption text-accent hover:underline">
              <Plus size={12} /> 희망 학교 추가
            </button>
          </div>
        </Section>

        {/* 학업/활동 계획 */}
        <Section title="3. 학업·활동 계획">
          <FormField label="학업 계획 (성적 목표, 보충할 과목 등)">
            <textarea
              value={plan.academic_plan || ""}
              onChange={(e) => updateField("academic_plan", e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </FormField>
          <FormField label="비교과 활동 계획 (동아리, 봉사, 대회 등)">
            <textarea
              value={plan.activity_plan || ""}
              onChange={(e) => updateField("activity_plan", e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </FormField>
        </Section>

        {/* 학기별 목표 */}
        <Section title="4. 학기별 목표 (선택)">
          <div className="space-y-2">
            {plan.semester_goals.map((g, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <input
                  value={g.semester}
                  onChange={(e) => updateSemGoal(idx, "semester", e.target.value)}
                  placeholder="예: 2-1"
                  className="col-span-2 px-2 py-1.5 border border-border-default rounded text-body"
                />
                <input
                  value={g.goal}
                  onChange={(e) => updateSemGoal(idx, "goal", e.target.value)}
                  placeholder="목표 내용"
                  className="col-span-9 px-2 py-1.5 border border-border-default rounded text-body"
                />
                <button onClick={() => removeSemGoal(idx)} className="col-span-1 text-status-error pt-1">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button onClick={addSemGoal}
                    className="flex items-center gap-1 text-caption text-accent hover:underline">
              <Plus size={12} /> 학기별 목표 추가
            </button>
          </div>
        </Section>

        {/* 동기/소개 */}
        <Section title="5. 진학 동기 / 자기소개">
          <textarea
            value={plan.motivation || ""}
            onChange={(e) => updateField("motivation", e.target.value)}
            rows={5}
            placeholder="왜 이 진로를 택했고, 어떤 사람으로 성장하고 싶은지 자유롭게 작성"
            className="w-full px-3 py-2 border border-border-default rounded text-body"
          />
        </Section>

        {/* 메모 */}
        <Section title="기타 메모">
          <textarea
            value={plan.notes || ""}
            onChange={(e) => updateField("notes", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-border-default rounded text-body"
          />
        </Section>

        <div className="flex gap-2 pt-2 border-t border-border-default">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50"
          >
            <Save size={14} /> {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: any) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 pb-1 border-b border-border-default">
        {Icon && <Icon size={15} className="text-accent" />}
        <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FormField({ label, children }: any) {
  return (
    <div>
      <label className="block text-caption text-text-secondary mb-1">{label}</label>
      {children}
    </div>
  );
}
