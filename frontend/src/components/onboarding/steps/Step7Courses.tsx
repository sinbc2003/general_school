"use client";

import { useState } from "react";
import { Sparkles, Info } from "lucide-react";

export function Step7Courses() {
  const [createGradeOffice, setCreateGradeOffice] = useState(true);
  const [createHomeroom, setCreateHomeroom] = useState(true);
  const [createSubject, setCreateSubject] = useState(false);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-body font-semibold text-text-primary">클래스룸 자동 생성</h2>
        <p className="text-caption text-text-tertiary mt-1">
          학기·교사·학생 데이터를 기반으로 강좌를 자동 생성합니다 (Phase 1.0-G에서 구현 예정).
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-2">
        <Info size={14} className="text-amber-600 mt-0.5" />
        <div className="text-[12px] text-amber-900">
          이 단계는 현재 미리보기만 제공합니다. 실제 자동 생성은 다음 업데이트에서 활성화됩니다.
          지금은 <strong>건너뛰기</strong>하거나 마법사 종료 후 <code>클래스룸</code> 페이지에서 수동으로 강좌를 만들 수 있습니다.
        </div>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={createGradeOffice}
            onChange={(e) => setCreateGradeOffice(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-body font-medium text-text-primary">학년부 강좌</div>
            <div className="text-[12px] text-text-tertiary mt-0.5">
              학년별 1개씩 (학년부장 = 소유자, 담임 = 공동교사). 학생 자동 등록 X (행정용).
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={createHomeroom}
            onChange={(e) => setCreateHomeroom(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-body font-medium text-text-primary">학급 강좌</div>
            <div className="text-[12px] text-text-tertiary mt-0.5">
              학급별 1개씩 (담임 = 소유자, 부담임 = 공동교사). 해당 학급 학생 자동 등록.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={createSubject}
            onChange={(e) => setCreateSubject(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-body font-medium text-text-primary">교과 강좌</div>
            <div className="text-[12px] text-text-tertiary mt-0.5">
              교사가 가르치는 과목별 강좌. 시간표 등록 후에 가능 (이번에는 권장 X).
            </div>
          </div>
        </label>

        <div className="pt-3 border-t border-border-default">
          <button
            type="button"
            disabled
            className="w-full px-4 py-2 text-[13px] bg-accent/50 text-white rounded-md cursor-not-allowed flex items-center justify-center gap-1"
          >
            <Sparkles size={14} /> 미리보기 (Phase 1.0-G에서 활성화)
          </button>
        </div>
      </div>

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 지금은 <strong>건너뛰기</strong> 또는 다음으로 진행하고, 강좌는 클래스룸 페이지에서 수동으로 만들 수 있습니다.
      </div>
    </div>
  );
}
