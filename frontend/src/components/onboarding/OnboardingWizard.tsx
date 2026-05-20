"use client";

/**
 * 온보딩 마법사 — super_admin 셋업 흐름.
 *
 * 8단계:
 *  1. 환영 + 학교 정보 (학교명·종류·학년수)
 *  2. 부서 등록 (예시 prefilled + 줄별 입력)
 *  3. 학기 등록 (이름·시작일·종료일)
 *  4. 교사 일괄 등록 (줄별 + CSV)
 *  5. 학생 일괄 등록 (줄별 + CSV)
 *  6. 학급 담임 매핑 (학생 데이터에서 자동 감지)
 *  7. 클래스룸 자동 생성 (학년부 + 학급 + 교과)
 *  8. 완료
 *
 * 각 단계 "다음"으로 진행 / "이전"으로 복귀 / "건너뛰기"로 스킵.
 * 닫고 다시 열어도 last_step부터 재개. completed_at 마크되면 자동 노출 X.
 * 단 super_admin이 언제든 "다시 보기"로 재실행 가능.
 */

import { useEffect, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api/client";

import { Step1Welcome } from "./steps/Step1Welcome";
import { Step2Departments } from "./steps/Step2Departments";
import { Step3Semesters } from "./steps/Step3Semesters";
import { Step4Teachers } from "./steps/Step4Teachers";
import { Step5Students } from "./steps/Step5Students";
import { Step6Homerooms } from "./steps/Step6Homerooms";
import { Step7Courses } from "./steps/Step7Courses";
import { Step8Done } from "./steps/Step8Done";

const STEPS = [
  { key: 1, label: "환영" },
  { key: 2, label: "부서" },
  { key: 3, label: "학기" },
  { key: 4, label: "교사" },
  { key: 5, label: "학생" },
  { key: 6, label: "담임" },
  { key: 7, label: "강좌" },
  { key: 8, label: "완료" },
];

interface OnboardingStatus {
  completed_at: string | null;
  last_step: number;
  school: { name: string | null; type: string; grade_count: number };
}

export function OnboardingWizard({
  onClose,
  forceShow = false,
}: {
  onClose: () => void;
  forceShow?: boolean;
}) {
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.get<OnboardingStatus>("/api/system/onboarding/status");
      setStatus(s);
      if (s.last_step && s.last_step > 0 && !forceShow) {
        setStep(Math.min(s.last_step, 8));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [forceShow]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const saveStep = async (s: number) => {
    try { await api.post("/api/system/onboarding/step", { step: s }); } catch {}
  };

  const goNext = async () => {
    if (step >= 8) return;
    const next = step + 1;
    setStep(next);
    await saveStep(next);
  };

  const goPrev = async () => {
    if (step <= 1) return;
    const prev = step - 1;
    setStep(prev);
    await saveStep(prev);
  };

  const skip = async () => {
    await goNext();
  };

  const complete = async () => {
    try {
      await api.post("/api/system/onboarding/complete", {});
    } catch {}
    onClose();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center">
        <div className="text-white">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-[20px]">🧙</div>
            <div>
              <div className="text-body font-semibold text-text-primary">셋업 마법사</div>
              <div className="text-[11px] text-text-tertiary">
                {step} / {STEPS.length} — {STEPS[step - 1]?.label}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-bg-secondary text-text-tertiary"
            title="닫기 (나중에 이어서)"
          >
            <X size={18} />
          </button>
        </div>

        {/* 단계 stepper */}
        <div className="px-6 py-3 border-b border-border-default bg-bg-secondary/30">
          <div className="flex items-center gap-1">
            {STEPS.map((s) => (
              <div key={s.key} className="flex-1 flex items-center gap-1">
                <div
                  className={`flex-1 h-1.5 rounded-full ${
                    s.key < step
                      ? "bg-emerald-500"
                      : s.key === step
                      ? "bg-accent"
                      : "bg-border-default"
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-text-tertiary">
            {STEPS.map((s) => (
              <div
                key={s.key}
                className={`flex-1 text-center ${s.key === step ? "text-accent font-semibold" : ""}`}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && <Step1Welcome status={status} onChange={setStatus} />}
          {step === 2 && <Step2Departments />}
          {step === 3 && <Step3Semesters gradeCount={status?.school.grade_count || 3} />}
          {step === 4 && <Step4Teachers />}
          {step === 5 && <Step5Students />}
          {step === 6 && <Step6Homerooms />}
          {step === 7 && <Step7Courses />}
          {step === 8 && <Step8Done />}
        </div>

        {/* 푸터 (이전/다음) */}
        <div className="px-6 py-4 border-t border-border-default flex items-center justify-between bg-bg-secondary/30">
          <button
            type="button"
            onClick={goPrev}
            disabled={step <= 1}
            className="px-4 py-2 text-[13px] text-text-secondary rounded-md hover:bg-bg-secondary disabled:opacity-30 disabled:hover:bg-transparent flex items-center gap-1"
          >
            <ChevronLeft size={14} /> 이전
          </button>
          <div className="flex items-center gap-2">
            {step < 8 && (
              <button
                type="button"
                onClick={skip}
                className="px-3 py-2 text-[12px] text-text-tertiary rounded-md hover:bg-bg-secondary"
              >
                건너뛰기
              </button>
            )}
            {step < 8 ? (
              <button
                type="button"
                onClick={goNext}
                className="px-5 py-2 text-[13px] bg-accent text-white rounded-md hover:opacity-90 flex items-center gap-1"
              >
                다음 <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={complete}
                className="px-5 py-2 text-[13px] bg-emerald-600 text-white rounded-md hover:opacity-90 flex items-center gap-1"
              >
                <CheckCircle2 size={14} /> 완료
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
