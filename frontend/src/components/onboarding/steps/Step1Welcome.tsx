"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

interface OnboardingStatus {
  completed_at: string | null;
  last_step: number;
  school: { name: string | null; type: string; grade_count: number };
}

export function Step1Welcome({
  status,
  onChange,
}: {
  status: OnboardingStatus | null;
  onChange: (s: OnboardingStatus) => void;
}) {
  const [name, setName] = useState(status?.school.name || "");
  const [type, setType] = useState(status?.school.type || "high");
  const [gradeCount, setGradeCount] = useState(status?.school.grade_count || 3);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(status?.school.name || "");
    setType(status?.school.type || "high");
    setGradeCount(status?.school.grade_count || 3);
  }, [status]);

  const save = async () => {
    if (!name.trim()) return;
    try {
      await api.post("/api/system/onboarding/school", {
        name: name.trim(),
        type,
        grade_count: gradeCount,
      });
      onChange({ ...(status as any), school: { name: name.trim(), type, grade_count: gradeCount } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      alert(e?.message || "저장 실패");
    }
  };

  return (
    <div>
      <div className="text-center py-6 mb-6 bg-gradient-to-br from-accent/10 to-purple-100/30 rounded-lg">
        <div className="text-[40px] mb-2">🎓</div>
        <h2 className="text-[20px] font-bold text-text-primary mb-1">
          학교 플랫폼에 오신 것을 환영합니다
        </h2>
        <p className="text-caption text-text-tertiary">
          8단계 마법사로 학교 기본 셋업을 끝낼 수 있습니다.
        </p>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5 max-w-xl mx-auto">
        <h3 className="text-body font-semibold text-text-primary mb-4">학교 정보</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">학교명 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 서울고등학교"
              className="w-full px-3 py-2 text-body border border-border-default rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">학교 종류</label>
            <div className="flex gap-2">
              {[["elem", "초등학교"], ["mid", "중학교"], ["high", "고등학교"]].map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setType(v)}
                  className={`flex-1 px-3 py-2 text-[13px] rounded-md border ${
                    type === v
                      ? "bg-accent text-white border-accent"
                      : "bg-bg-primary text-text-primary border-border-default hover:bg-bg-secondary"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">학년 수</label>
            <input
              type="number"
              min={1}
              max={6}
              value={gradeCount}
              onChange={(e) => setGradeCount(Math.max(1, Math.min(6, Number(e.target.value))))}
              className="w-24 px-3 py-2 text-body border border-border-default rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="ml-2 text-caption text-text-tertiary">학년 (보통 고등학교 3, 중학교 3, 초등학교 6)</span>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={save}
              disabled={!name.trim()}
              className="px-4 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-40"
            >
              저장
            </button>
            {saved && <span className="text-emerald-600 text-[12px]">✓ 저장됨</span>}
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-caption text-text-tertiary">
        다음 단계에서 부서, 학기, 교사·학생을 차례로 등록합니다.
      </div>
    </div>
  );
}
