"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2, Target, GraduationCap, ChevronDown, ChevronRight, X } from "lucide-react";
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
  id: number;
  year: number;
  desired_field: string | null;
  career_goal: string | null;
  target_universities: UnivTarget[];
  target_majors: string[];
  academic_plan: string | null;
  activity_plan: string | null;
  semester_goals: SemesterGoal[];
  motivation: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string | null;
}

const EMPTY_PLAN: Omit<CareerPlan, "id" | "updated_at"> = {
  year: new Date().getFullYear(),
  desired_field: "", career_goal: "",
  target_universities: [],
  target_majors: [],
  academic_plan: "", activity_plan: "",
  semester_goals: [],
  motivation: "", notes: "",
  is_active: true,
};

export default function CareerPlanPage() {
  const [plans, setPlans] = useState<CareerPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CareerPlan | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/career-plans");
      setPlans(data.items);
      if (data.items.length === 0 && !editing) {
        // 자동으로 새 계획 시작
        setEditing({ ...EMPTY_PLAN, id: -1, updated_at: null } as CareerPlan);
      } else if (data.items.length > 0 && !editing) {
        setEditing(data.items[0]);
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.id < 0) {
        await api.post("/api/me/career-plans", editing);
      } else {
        await api.put(`/api/me/career-plans/${editing.id}`, editing);
      }
      await load();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    if (!confirm("이 진로 계획을 삭제하시겠습니까?")) return;
    await api.delete(`/api/me/career-plans/${id}`);
    setEditing(null);
    await load();
  };

  const startNew = () => {
    setEditing({ ...EMPTY_PLAN, id: -1, updated_at: null } as CareerPlan);
  };

  const updateField = (field: keyof CareerPlan, value: any) => {
    if (!editing) return;
    setEditing({ ...editing, [field]: value });
  };

  const addUniv = () => {
    if (!editing) return;
    setEditing({
      ...editing,
      target_universities: [
        ...editing.target_universities,
        { university: "", major: "", admission_type: "수시", priority: editing.target_universities.length + 1 },
      ],
    });
  };
  const updateUniv = (idx: number, field: keyof UnivTarget, value: any) => {
    if (!editing) return;
    const next = [...editing.target_universities];
    next[idx] = { ...next[idx], [field]: value };
    setEditing({ ...editing, target_universities: next });
  };
  const removeUniv = (idx: number) => {
    if (!editing) return;
    setEditing({
      ...editing,
      target_universities: editing.target_universities.filter((_, i) => i !== idx),
    });
  };

  const addSemGoal = () => {
    if (!editing) return;
    setEditing({
      ...editing,
      semester_goals: [...editing.semester_goals, { semester: "", goal: "" }],
    });
  };
  const updateSemGoal = (idx: number, field: keyof SemesterGoal, value: string) => {
    if (!editing) return;
    const next = [...editing.semester_goals];
    next[idx] = { ...next[idx], [field]: value };
    setEditing({ ...editing, semester_goals: next });
  };
  const removeSemGoal = (idx: number) => {
    if (!editing) return;
    setEditing({
      ...editing,
      semester_goals: editing.semester_goals.filter((_, i) => i !== idx),
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">진로/진학 설계</h1>
          <p className="text-caption text-text-tertiary mt-0.5">
            희망 진로, 진학 목표, 학기별 계획을 정리하세요. 매년 보완할 수 있습니다.
          </p>
        </div>
        <button onClick={startNew} className="flex items-center gap-1 px-3 py-2 bg-accent text-white rounded text-body">
          <Plus size={14} /> 새 계획
        </button>
      </div>

      {/* 연도별 탭 */}
      {plans.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {plans.map((p) => (
            <button
              key={p.id}
              onClick={() => setEditing(p)}
              className={`px-3 py-1.5 text-caption rounded ${
                editing?.id === p.id ? "bg-accent text-white" : "bg-bg-primary border border-border-default"
              }`}
            >
              {p.year}년 계획
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : editing ? (
        <div className="bg-bg-primary border border-border-default rounded-lg p-5 space-y-5">
          {/* 작성 연도 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-caption text-text-secondary">작성 연도</label>
              <input
                type="number"
                value={editing.year}
                onChange={(e) => updateField("year", parseInt(e.target.value) || new Date().getFullYear())}
                className="w-24 px-2 py-1 border border-border-default rounded text-body"
              />
            </div>
            {editing.id > 0 && (
              <button onClick={() => remove(editing.id)}
                      className="flex items-center gap-1 text-caption text-status-error hover:underline">
                <Trash2 size={12} /> 이 계획 삭제
              </button>
            )}
          </div>

          {/* 진로 방향 */}
          <Section title="1. 진로 방향" icon={Target}>
            <FormField label="희망 진로 분야">
              <input
                value={editing.desired_field || ""}
                onChange={(e) => updateField("desired_field", e.target.value)}
                placeholder="예: 컴퓨터공학, 의학, 인문학..."
                className="w-full px-3 py-2 border border-border-default rounded text-body"
              />
            </FormField>
            <FormField label="장래 희망 / 직업">
              <textarea
                value={editing.career_goal || ""}
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
              {editing.target_universities.map((u, idx) => (
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
                value={editing.academic_plan || ""}
                onChange={(e) => updateField("academic_plan", e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-border-default rounded text-body"
              />
            </FormField>
            <FormField label="비교과 활동 계획 (동아리, 봉사, 대회 등)">
              <textarea
                value={editing.activity_plan || ""}
                onChange={(e) => updateField("activity_plan", e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-border-default rounded text-body"
              />
            </FormField>
          </Section>

          {/* 학기별 목표 */}
          <Section title="4. 학기별 목표">
            <div className="space-y-2">
              {editing.semester_goals.map((g, idx) => (
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
              value={editing.motivation || ""}
              onChange={(e) => updateField("motivation", e.target.value)}
              rows={5}
              placeholder="왜 이 진로를 택했고, 어떤 사람으로 성장하고 싶은지 자유롭게 작성"
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </Section>

          {/* 메모 */}
          <Section title="기타 메모">
            <textarea
              value={editing.notes || ""}
              onChange={(e) => updateField("notes", e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
          </Section>

          <div className="flex gap-2 pt-2 border-t border-border-default">
            <button onClick={save} disabled={saving}
                    className="flex items-center gap-1 px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50">
              <Save size={14} /> {saving ? "저장 중..." : "저장"}
            </button>
            {editing.updated_at && (
              <span className="text-caption text-text-tertiary self-center">
                마지막 저장: {editing.updated_at.replace("T", " ").slice(0, 16)}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="text-text-tertiary">계획을 선택하거나 새로 작성하세요</div>
      )}
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
