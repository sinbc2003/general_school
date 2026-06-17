"use client";

/** 조건 패널 — 인접 금지 / 짝으로 앉기 / 혼자 앉기 (학생에겐 안 보임, 교사 전용). */

import { useState } from "react";
import { Ban, Users, User, X, Plus } from "lucide-react";
import { Constraints, RosterEntry } from "../../_shared";

interface Props {
  roster: RosterEntry[];
  constraints: Constraints;
  onChange: (c: Constraints) => void;
}

export default function ConstraintsPanel({ roster, constraints, onChange }: Props) {
  const nameOf = (key: string) => roster.find((r) => r.key === key)?.name ?? "(없는 학생)";
  const set = (patch: Partial<Constraints>) => onChange({ ...constraints, ...patch });

  const aloneSet = new Set(constraints.alone);
  const fixedCount = Object.keys(constraints.fixed || {}).length;

  return (
    <div className="space-y-7 max-w-3xl">
      {roster.length === 0 && (
        <div className="text-caption text-text-tertiary border border-dashed border-border-default rounded-lg p-4">
          먼저 ‘명단’ 탭에서 학생을 추가하세요.
        </div>
      )}

      <PairSection
        icon={<Ban size={16} className="text-rose-500" />}
        title="인접 금지"
        desc="두 학생을 서로 옆·앞뒤(인접한 자리)에 배치하지 않습니다."
        roster={roster}
        pairs={constraints.forbidden_pairs}
        nameOf={nameOf}
        onChange={(forbidden_pairs) => set({ forbidden_pairs })}
        accent="rose"
      />

      <PairSection
        icon={<Users size={16} className="text-indigo-500" />}
        title="짝으로 앉기"
        desc="두 학생을 같은 2인 책상에 나란히 앉힙니다. (2인 책상이 충분해야 함)"
        roster={roster}
        pairs={constraints.keep_together}
        nameOf={nameOf}
        onChange={(keep_together) => set({ keep_together })}
        accent="indigo"
      />

      {/* 혼자 앉기 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <User size={16} className="text-amber-600" />
          <h3 className="text-body font-semibold">혼자 앉기</h3>
        </div>
        <p className="text-caption text-text-tertiary mb-2">선택한 학생은 책상을 혼자 씁니다. (2인 책상이면 옆자리를 비웁니다)</p>
        {roster.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {roster.map((r) => {
              const on = aloneSet.has(r.key);
              return (
                <button
                  key={r.key}
                  onClick={() =>
                    set({ alone: on ? constraints.alone.filter((k) => k !== r.key) : [...constraints.alone, r.key] })
                  }
                  className={`px-2.5 py-1 rounded-full text-caption border ${
                    on ? "border-amber-400 bg-amber-50 text-amber-700" : "border-border-default hover:bg-bg-secondary"
                  }`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 고정 자리 안내 */}
      <div className="text-caption text-text-tertiary border-t border-border-default pt-4">
        <b className="text-text-secondary">고정 자리</b>는 ‘배치’ 탭에서 학생을 자리에 둔 뒤 📌(핀)을 눌러 지정합니다.
        {fixedCount > 0 && (
          <>
            {" "}현재 {fixedCount}개 고정됨.
            <button
              onClick={() => { if (confirm("모든 고정 자리를 해제할까요?")) set({ fixed: {} }); }}
              className="ml-2 text-rose-600 hover:underline"
            >
              모두 해제
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PairSection({
  icon, title, desc, roster, pairs, nameOf, onChange, accent,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  roster: RosterEntry[];
  pairs: [string, string][];
  nameOf: (k: string) => string;
  onChange: (pairs: [string, string][]) => void;
  accent: "rose" | "indigo";
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  const add = () => {
    if (!a || !b || a === b) return;
    const exists = pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    if (exists) { setA(""); setB(""); return; }
    onChange([...pairs, [a, b]]);
    setA(""); setB("");
  };
  const remove = (i: number) => onChange(pairs.filter((_, idx) => idx !== i));

  const chip = accent === "rose"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-indigo-200 bg-indigo-50 text-indigo-700";

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="text-body font-semibold">{title}</h3>
      </div>
      <p className="text-caption text-text-tertiary mb-2">{desc}</p>
      {roster.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <select value={a} onChange={(e) => setA(e.target.value)} className="px-2 py-1.5 border border-border-default rounded text-body bg-bg-primary max-w-[160px]">
            <option value="">학생 선택</option>
            {roster.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
          <span className="text-text-tertiary">–</span>
          <select value={b} onChange={(e) => setB(e.target.value)} className="px-2 py-1.5 border border-border-default rounded text-body bg-bg-primary max-w-[160px]">
            <option value="">학생 선택</option>
            {roster.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
          <button onClick={add} disabled={!a || !b || a === b} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-caption">
            <Plus size={14} /> 추가
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {pairs.length === 0 && <span className="text-caption text-text-tertiary">없음</span>}
        {pairs.map((p, i) => (
          <span key={i} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-caption ${chip}`}>
            {nameOf(p[0])} ↔ {nameOf(p[1])}
            <button onClick={() => remove(i)} className="hover:opacity-70"><X size={12} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}
