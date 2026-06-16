"use client";

/**
 * 실시간 투표 — 학생 PIN 입장.
 * PIN 입력 → /s/poll/{pin} (자동 입장 + 응답 화면).
 * 라이브 퀴즈(/s/quiz)와 동일한 진입 패턴.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";

export default function PollJoinPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");

  const go = () => {
    const p = pin.trim();
    if (p.length >= 4) router.push(`/s/poll/${p}`);
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <BarChart3 size={44} className="mx-auto text-teal-600 mb-3" />
        <h1 className="text-title font-semibold mb-1">실시간 투표</h1>
        <p className="text-caption text-text-tertiary mb-6">
          선생님 화면의 PIN을 입력하세요
        </p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          inputMode="numeric"
          placeholder="투표 PIN"
          autoFocus
          className="w-full text-center font-mono text-3xl tracking-[0.3em] px-4 py-3 border-2 border-border-default focus:border-teal-500 rounded-xl outline-none mb-4"
        />
        <button
          onClick={go}
          disabled={pin.trim().length < 4}
          className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl text-body font-semibold"
        >
          입장
        </button>
      </div>
    </div>
  );
}
