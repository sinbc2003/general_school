"use client";

/**
 * 자리배치 편집기 — 배치 / 명단 / 교실 배치 / 조건 4탭.
 *
 * 배치 탭: 좌석 클릭으로 스왑, 미배치 학생 클릭 후 좌석 클릭으로 배치, 📌로 자리 고정.
 * 랜덤 배치는 서버 솔버(제약 충족)를 호출. 변경은 자동 저장(디바운스).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft, Shuffle, Printer, ExternalLink, Eraser, Loader2,
  Check, AlertTriangle, Armchair, Users, LayoutGrid, SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToolFocusMode } from "@/lib/use-tool-focus";
import { openToolWindow } from "@/lib/open-tool-window";
import {
  Chart, Constraints, Layout, RosterEntry, normalizeChart, studentLabel,
} from "../_shared";
import RoomChart from "./_components/RoomChart";
import RosterPanel from "./_components/RosterPanel";
import LayoutPanel from "./_components/LayoutPanel";
import ConstraintsPanel from "./_components/ConstraintsPanel";

type Tab = "seat" | "roster" | "layout" | "rules";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "seat", label: "배치", icon: Armchair },
  { key: "roster", label: "명단", icon: Users },
  { key: "layout", label: "교실 배치", icon: LayoutGrid },
  { key: "rules", label: "조건", icon: SlidersHorizontal },
];

export default function SeatingEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);
  useToolFocusMode();

  const [chart, setChart] = useState<Chart | null>(null);
  const [tab, setTab] = useState<Tab>("seat");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [keepFixed, setKeepFixed] = useState(true);

  // 배치 상호작용
  const [selSeat, setSelSeat] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const chartRef = useRef<Chart | null>(null);
  chartRef.current = chart;

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/api/tools/seating/${id}`);
        setChart(normalizeChart(res));
      } catch (e: any) {
        setError(e?.detail || "자리표를 불러올 수 없습니다");
      }
    })();
  }, [id]);

  const patch = useCallback((updater: (c: Chart) => Chart) => {
    setChart((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    const c = chartRef.current;
    if (!c) return;
    setSaving(true);
    try {
      await api.put(`/api/tools/seating/${id}`, {
        title: c.title,
        description: c.description,
        layout: c.layout,
        roster: c.roster,
        constraints: c.constraints,
        assignment: c.assignment,
      });
      setDirty(false);
    } catch {
      /* 다음 변경에서 재시도 */
    } finally {
      setSaving(false);
    }
  }, [id]);

  // 자동 저장 (디바운스)
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { void save(); }, 1200);
    return () => clearTimeout(t);
  }, [dirty, chart, save]);

  const placedKeys = useMemo(
    () => new Set(Object.values(chart?.assignment ?? {})),
    [chart?.assignment],
  );
  const excludedSet = useMemo(
    () => new Set(chart?.constraints.excluded ?? []),
    [chart?.constraints.excluded],
  );
  const unplaced: RosterEntry[] = useMemo(
    () => (chart?.roster ?? []).filter((r) => !excludedSet.has(r.key) && !placedKeys.has(r.key)),
    [chart?.roster, excludedSet, placedKeys],
  );

  // ── 배치 조작 헬퍼 ────────────────────────────────────────────────
  const swapSeats = (s1: string, s2: string) => {
    patch((c) => {
      const a = { ...c.assignment };
      const k1 = a[s1];
      const k2 = a[s2];
      delete a[s1]; delete a[s2];
      if (k1) a[s2] = k1;
      if (k2) a[s1] = k2;
      const fixed = { ...c.constraints.fixed };
      if (k1 && fixed[k1]) fixed[k1] = s2;
      if (k2 && fixed[k2]) fixed[k2] = s1;
      return { ...c, assignment: a, constraints: { ...c.constraints, fixed } };
    });
  };

  const placeKeyAt = (key: string, sid: string) => {
    patch((c) => {
      const a = { ...c.assignment };
      // key가 이미 다른 좌석에 있으면 비움
      for (const s of Object.keys(a)) if (a[s] === key) delete a[s];
      const evicted = a[sid];
      a[sid] = key;
      const fixed = { ...c.constraints.fixed };
      if (fixed[key]) fixed[key] = sid;
      if (evicted && fixed[evicted]) delete fixed[evicted]; // 밀려난 학생은 고정 해제
      return { ...c, assignment: a, constraints: { ...c.constraints, fixed } };
    });
  };

  const onSeatClick = (sid: string) => {
    if (pendingKey) {
      placeKeyAt(pendingKey, sid);
      setPendingKey(null);
      return;
    }
    if (selSeat === null) {
      setSelSeat(sid);
    } else if (selSeat === sid) {
      setSelSeat(null);
    } else {
      swapSeats(selSeat, sid);
      setSelSeat(null);
    }
  };

  const onPinToggle = (sid: string) => {
    patch((c) => {
      const key = c.assignment[sid];
      if (!key) return c;
      const fixed = { ...c.constraints.fixed };
      if (fixed[key] === sid) delete fixed[key];
      else fixed[key] = sid;
      return { ...c, constraints: { ...c.constraints, fixed } };
    });
  };

  const shuffle = async () => {
    if (!chart) return;
    setShuffling(true);
    setWarnings([]);
    try {
      await save(); // 최신 명단·조건·배치를 먼저 저장 (서버 솔버가 DB에서 읽음)
      const res = await api.post<{ assignment: Record<string, string>; warnings: string[] }>(
        `/api/tools/seating/${id}/shuffle`,
        { save: true, keep_fixed: keepFixed },
      );
      setChart((prev) => (prev ? { ...prev, assignment: res.assignment } : prev));
      setWarnings(res.warnings || []);
      setDirty(false);
      setSelSeat(null);
      setPendingKey(null);
    } catch (e: any) {
      setWarnings([e?.detail || "배치에 실패했습니다"]);
    } finally {
      setShuffling(false);
    }
  };

  const clearSeats = () => {
    if (!confirm("배치를 모두 비울까요? (고정 자리도 해제됩니다)")) return;
    patch((c) => ({ ...c, assignment: {}, constraints: { ...c.constraints, fixed: {} } }));
    setSelSeat(null);
    setPendingKey(null);
  };

  const openPrint = async () => {
    await save();
    window.open(`/tools/seating/${id}/print`, "_blank");
  };

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/tools/seating" className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary"><ChevronLeft size={14} /> 자리배치</Link>
        <div className="mt-6 text-center text-rose-600">{error}</div>
      </div>
    );
  }
  if (!chart) {
    return <div className="p-10 text-center text-text-tertiary"><Loader2 className="animate-spin inline" /> 불러오는 중...</div>;
  }

  const setLayout = (layout: Layout) => patch((c) => ({ ...c, layout }));
  const setRoster = (roster: RosterEntry[]) => patch((c) => ({ ...c, roster }));
  const setConstraints = (constraints: Constraints) => patch((c) => ({ ...c, constraints }));
  const toggleExcluded = (key: string) =>
    patch((c) => {
      const ex = new Set(c.constraints.excluded);
      ex.has(key) ? ex.delete(key) : ex.add(key);
      return { ...c, constraints: { ...c.constraints, excluded: Array.from(ex) } };
    });

  return (
    <div className="p-5 max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-3">
        <Link href="/tools/seating" className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary">
          <ChevronLeft size={14} /> 자리배치
        </Link>
        <div className="ml-auto flex items-center gap-1.5 text-caption text-text-tertiary">
          {saving ? (<><Loader2 size={13} className="animate-spin" /> 저장 중</>)
            : dirty ? "변경됨"
            : (<><Check size={13} className="text-emerald-600" /> 저장됨</>)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={chart.title}
          onChange={(e) => patch((c) => ({ ...c, title: e.target.value }))}
          className="text-title font-semibold bg-transparent border-b border-transparent hover:border-border-default focus:border-emerald-500 outline-none px-1 min-w-[200px]"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1 text-caption text-text-secondary cursor-pointer mr-1">
            <input type="checkbox" checked={keepFixed} onChange={(e) => setKeepFixed(e.target.checked)} />
            고정 유지
          </label>
          <button
            onClick={shuffle}
            disabled={shuffling}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-body font-medium"
          >
            {shuffling ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} />} 랜덤 배치
          </button>
          <button onClick={clearSeats} className="inline-flex items-center gap-1.5 px-3 py-2 border border-border-default rounded-lg text-body hover:bg-bg-secondary">
            <Eraser size={15} /> 비우기
          </button>
          <button onClick={openPrint} className="inline-flex items-center gap-1.5 px-3 py-2 border border-border-default rounded-lg text-body hover:bg-bg-secondary">
            <Printer size={15} /> 인쇄
          </button>
          <button onClick={() => openToolWindow(`/tools/seating/${id}`)} className="inline-flex items-center gap-1.5 px-3 py-2 border border-border-default rounded-lg text-caption text-text-secondary hover:bg-bg-secondary">
            <ExternalLink size={13} /> 새 창
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border-default mb-5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-body border-b-2 -mb-px transition ${
              tab === key ? "border-emerald-600 text-emerald-700 font-medium" : "border-transparent text-text-tertiary hover:text-text-primary"
            }`}
          >
            <Icon size={15} /> {label}
            {key === "roster" && chart.roster.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-secondary">{chart.roster.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "seat" && (
        <div>
          {warnings.length > 0 && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-caption">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium mb-0.5">일부 조건을 완벽히 지키지 못했어요</div>
                <ul className="list-disc ml-4 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            </div>
          )}

          {unplaced.length > 0 && (
            <div className="mb-4">
              <div className="text-caption text-text-tertiary mb-1.5">
                미배치 {unplaced.length}명 — 학생을 누른 뒤 빈 자리를 클릭하면 배치됩니다.
              </div>
              <div className="flex flex-wrap gap-1.5">
                {unplaced.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => { setPendingKey(pendingKey === r.key ? null : r.key); setSelSeat(null); }}
                    className={`px-2.5 py-1 rounded-full text-caption border ${
                      pendingKey === r.key ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300" : "border-border-default hover:bg-bg-secondary"
                    }`}
                  >
                    {studentLabel(r)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chart.layout.desks.length === 0 ? (
            <div className="text-center text-caption text-text-tertiary py-12 border border-dashed border-border-default rounded-lg">
              ‘교실 배치’ 탭에서 책상을 먼저 만드세요.
            </div>
          ) : (
            <div className="overflow-auto">
              <RoomChart
                layout={chart.layout}
                roster={chart.roster}
                assignment={chart.assignment}
                constraints={chart.constraints}
                mode="seating"
                selectedSeat={selSeat}
                onSeatClick={onSeatClick}
                onPinToggle={onPinToggle}
              />
            </div>
          )}
        </div>
      )}

      {tab === "roster" && (
        <RosterPanel
          roster={chart.roster}
          excluded={chart.constraints.excluded}
          onChange={setRoster}
          onToggleExcluded={toggleExcluded}
        />
      )}

      {tab === "layout" && <LayoutPanel layout={chart.layout} onChange={setLayout} />}

      {tab === "rules" && (
        <ConstraintsPanel roster={chart.roster} constraints={chart.constraints} onChange={setConstraints} />
      )}
    </div>
  );
}
