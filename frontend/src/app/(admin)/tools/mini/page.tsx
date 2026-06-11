"use client";

/**
 * 수업 소도구 — 교사 화면(프로젝터)용 작고 빠른 도구 4종.
 *
 *  1. 이름 뽑기   — 슬롯머신식 룰렛 (강좌 명단 또는 직접 입력, 뽑힌 사람 제외 옵션)
 *  2. 모둠 편성   — 모둠 수/모둠당 인원 기준 랜덤 편성
 *  3. 타이머      — 프리셋+커스텀 카운트다운, 종료 시 비프(WebAudio)+점멸
 *  4. 신호등      — 활동 신호 (빨강=조용히 / 노랑=짝활동 / 초록=모둠활동), 키보드 1/2/3
 *
 * 전부 클라이언트 사이드 — 백엔드 변경 없음. 명단은 본인 강좌 API 재사용.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, Dices, Users2, Timer as TimerIcon, CircleDot,
  Play, Pause, RotateCcw, Shuffle, Loader2, Maximize2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToolFocusMode } from "@/lib/use-tool-focus";

type Tab = "roulette" | "groups" | "timer" | "light";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "roulette", label: "이름 뽑기", icon: Dices },
  { key: "groups", label: "모둠 편성", icon: Users2 },
  { key: "timer", label: "타이머", icon: TimerIcon },
  { key: "light", label: "신호등", icon: CircleDot },
];

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MiniToolsPage() {
  useToolFocusMode();
  const [tab, setTab] = useState<Tab>("roulette");
  const [names, setNames] = useState<string[]>([]);
  const fullRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    const el = fullRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      el.requestFullscreen?.().catch(() => undefined);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-1"
          >
            <ChevronLeft size={14} /> 도구 모음
          </Link>
          <h1 className="text-title font-semibold flex items-center gap-2">
            <Dices size={22} className="text-emerald-600" /> 수업 소도구
          </h1>
        </div>
        <button
          onClick={toggleFullscreen}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border-default rounded-lg text-caption text-text-secondary hover:bg-bg-secondary"
          title="프로젝터 표시용 전체 화면"
        >
          <Maximize2 size={14} /> 전체 화면
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border-default mb-5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-body border-b-2 -mb-px transition ${
              tab === key
                ? "border-emerald-600 text-emerald-700 font-medium"
                : "border-transparent text-text-tertiary hover:text-text-primary"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div ref={fullRef} className="bg-bg-primary rounded-xl fullscreen:p-10 [&:fullscreen]:p-10 [&:fullscreen]:overflow-y-auto">
        {(tab === "roulette" || tab === "groups") && (
          <RosterPanel names={names} onChange={setNames} />
        )}
        {tab === "roulette" && <RouletteTool names={names} />}
        {tab === "groups" && <GroupsTool names={names} />}
        {tab === "timer" && <TimerTool />}
        {tab === "light" && <TrafficLightTool />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 명단 패널 (룰렛·모둠 공유)
// ─────────────────────────────────────────────────────────────────────────────

interface CourseItem { id: number; name: string }

function RosterPanel({
  names, onChange,
}: { names: string[]; onChange: (n: string[]) => void }) {
  const [courses, setCourses] = useState<CourseItem[] | null>(null);
  const [courseId, setCourseId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(names.length === 0);
  const [text, setText] = useState(names.join("\n"));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ items?: CourseItem[]; courses?: CourseItem[] } | CourseItem[]>(
          "/api/classroom/courses",
        );
        const list: CourseItem[] = Array.isArray(res)
          ? res
          : (res.items || (res as any).courses || []);
        if (!cancelled) setCourses(list);
      } catch {
        if (!cancelled) setCourses([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadCourse = async (cid: string) => {
    setCourseId(cid);
    if (!cid) return;
    setLoading(true);
    try {
      const res = await api.get<{ students: { name: string }[] }>(
        `/api/classroom/courses/${cid}`,
      );
      const list = (res.students || []).map((s) => s.name).filter(Boolean);
      setText(list.join("\n"));
      onChange(list);
    } catch (e: any) {
      alert(e?.detail || "명단을 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  };

  const applyText = (t: string) => {
    setText(t);
    onChange(t.split("\n").map((x) => x.trim()).filter(Boolean));
  };

  return (
    <div className="border border-border-default rounded-xl p-4 mb-5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-body font-medium"
      >
        <span>명단 ({names.length}명)</span>
        <span className="text-caption text-text-tertiary">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-caption text-text-tertiary mb-1">내 강좌에서 불러오기</div>
            <div className="flex items-center gap-2">
              <select
                value={courseId}
                onChange={(e) => loadCourse(e.target.value)}
                className="flex-1 px-2 py-2 border border-border-default rounded text-body bg-bg-primary"
              >
                <option value="">강좌 선택...</option>
                {(courses || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {loading && <Loader2 size={15} className="animate-spin text-text-tertiary" />}
            </div>
            <div className="text-[11px] text-text-tertiary mt-1.5">
              또는 오른쪽에 직접 입력 (한 줄에 1명)
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => applyText(e.target.value)}
            rows={5}
            placeholder={"김철수\n이영희\n박민수"}
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-emerald-500 resize-y"
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 이름 뽑기 (슬롯머신식)
// ─────────────────────────────────────────────────────────────────────────────

function RouletteTool({ names }: { names: string[] }) {
  const [display, setDisplay] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [excludePicked, setExcludePicked] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pool = useMemo(
    () => (excludePicked ? names.filter((n) => !picked.includes(n)) : names),
    [names, picked, excludePicked],
  );

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const spin = () => {
    if (spinning || pool.length === 0) return;
    setSpinning(true);
    setWinner(null);
    const target = pool[Math.floor(Math.random() * pool.length)];
    const start = Date.now();
    const totalMs = 2600;
    let i = Math.floor(Math.random() * pool.length);

    const tick = () => {
      const elapsed = Date.now() - start;
      if (elapsed >= totalMs) {
        setDisplay(target);
        setWinner(target);
        setPicked((p) => (p.includes(target) ? p : [...p, target]));
        setSpinning(false);
        return;
      }
      i = (i + 1) % pool.length;
      setDisplay(pool[i]);
      // 점점 감속: 40ms → 280ms
      const t = elapsed / totalMs;
      const delay = 40 + 240 * t * t;
      timerRef.current = setTimeout(tick, delay);
    };
    tick();
  };

  return (
    <div className="text-center py-6">
      <div
        className={`mx-auto max-w-lg min-h-[140px] flex items-center justify-center rounded-2xl border-4 transition-colors ${
          winner ? "border-emerald-500 bg-emerald-50" : "border-border-default bg-bg-secondary/50"
        }`}
      >
        <span className={`font-extrabold ${winner ? "text-emerald-700 text-6xl" : "text-text-primary text-5xl"}`}>
          {display ?? (pool.length > 0 ? "?" : "명단을 먼저 입력하세요")}
        </span>
      </div>
      {winner && <div className="text-body text-emerald-700 font-semibold mt-3">🎉 당첨!</div>}

      <div className="flex items-center justify-center gap-3 mt-6">
        <button
          onClick={spin}
          disabled={spinning || pool.length === 0}
          className="inline-flex items-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-lg font-semibold"
        >
          <Dices size={20} /> {spinning ? "추첨 중..." : "뽑기"}
        </button>
        {picked.length > 0 && (
          <button
            onClick={() => { setPicked([]); setWinner(null); setDisplay(null); }}
            className="inline-flex items-center gap-1.5 px-4 py-3 border border-border-default rounded-xl text-body hover:bg-bg-secondary"
          >
            <RotateCcw size={15} /> 초기화
          </button>
        )}
      </div>

      <label className="inline-flex items-center gap-1.5 mt-4 text-caption text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={excludePicked}
          onChange={(e) => setExcludePicked(e.target.checked)}
        />
        뽑힌 사람 제외 (남은 {pool.length}명)
      </label>

      {picked.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5 max-w-xl mx-auto">
          {picked.map((n, i) => (
            <span key={i} className="px-2.5 py-1 bg-bg-secondary border border-border-default rounded-full text-caption">
              {i + 1}. {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 모둠 편성
// ─────────────────────────────────────────────────────────────────────────────

function GroupsTool({ names }: { names: string[] }) {
  const [mode, setMode] = useState<"count" | "size">("count");
  const [num, setNum] = useState(4);
  const [groups, setGroups] = useState<string[][] | null>(null);

  const make = () => {
    if (names.length === 0) return;
    const shuffled = shuffleArr(names);
    const n = Math.max(1, num);
    const groupCount = mode === "count" ? Math.min(n, shuffled.length) : Math.ceil(shuffled.length / n);
    const out: string[][] = Array.from({ length: groupCount }, () => []);
    shuffled.forEach((name, i) => out[i % groupCount].push(name));
    setGroups(out);
  };

  return (
    <div className="py-4">
      <div className="flex items-center justify-center gap-3 flex-wrap mb-6">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "count" | "size")}
          className="px-3 py-2 border border-border-default rounded-lg text-body bg-bg-primary"
        >
          <option value="count">모둠 수로</option>
          <option value="size">모둠당 인원으로</option>
        </select>
        <input
          type="number"
          min={1}
          max={50}
          value={num}
          onChange={(e) => setNum(parseInt(e.target.value, 10) || 1)}
          className="w-20 px-3 py-2 border border-border-default rounded-lg text-body text-center outline-none focus:border-emerald-500"
        />
        <span className="text-body text-text-secondary">{mode === "count" ? "개 모둠" : "명씩"}</span>
        <button
          onClick={make}
          disabled={names.length === 0}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-semibold"
        >
          <Shuffle size={17} /> {groups ? "다시 섞기" : "편성"}
        </button>
      </div>

      {names.length === 0 && (
        <div className="text-center text-caption text-text-tertiary py-8">
          위 명단을 먼저 입력하세요.
        </div>
      )}

      {groups && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {groups.map((g, i) => (
            <div key={i} className="border-2 border-emerald-200 bg-emerald-50/50 rounded-xl p-3">
              <div className="text-body font-bold text-emerald-700 mb-2">{i + 1}모둠 ({g.length}명)</div>
              <ul className="space-y-1">
                {g.map((n, j) => (
                  <li key={j} className="text-body">{n}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 타이머
// ─────────────────────────────────────────────────────────────────────────────

const TIMER_PRESETS = [60, 180, 300, 600];

// AudioContext는 사용자 제스처(시작 버튼 클릭) 시점에 생성/resume해야
// autoplay 정책에 안 걸림. 모듈 단위 1개 재사용.
let _audioCtx: AudioContext | null = null;

function ensureAudio() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!_audioCtx) _audioCtx = new Ctx();
    if (_audioCtx && _audioCtx.state === "suspended") {
      _audioCtx.resume().catch(() => undefined);
    }
  } catch { /* noop */ }
}

function beep() {
  try {
    ensureAudio();
    const ctx = _audioCtx;
    if (!ctx || ctx.state !== "running") return;
    [0, 0.35, 0.7].forEach((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.3);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.32);
    });
  } catch { /* 사운드 실패는 무시 */ }
}

function TimerTool() {
  const [totalSec, setTotalSec] = useState(180);
  const [remainMs, setRemainMs] = useState(180_000);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const endAtRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  useEffect(() => () => stopInterval(), []);

  const start = () => {
    if (running || remainMs <= 0) return;
    stopInterval(); // pause→start 연타 시 interval 중복 방지 (방어적)
    ensureAudio();  // 사용자 제스처 시점에 AudioContext 준비 (종료 비프용)
    setFinished(false);
    endAtRef.current = Date.now() + remainMs;
    setRunning(true);
    intervalRef.current = setInterval(() => {
      const left = endAtRef.current - Date.now();
      if (left <= 0) {
        setRemainMs(0);
        setRunning(false);
        setFinished(true);
        stopInterval();
        beep();
      } else {
        setRemainMs(left);
      }
    }, 200);
  };

  const pause = () => {
    stopInterval();
    setRunning(false);
    setRemainMs(Math.max(0, endAtRef.current - Date.now()));
  };

  const reset = (sec?: number) => {
    stopInterval();
    setRunning(false);
    setFinished(false);
    const s = sec ?? totalSec;
    setTotalSec(s);
    setRemainMs(s * 1000);
  };

  const mm = Math.floor(remainMs / 60000);
  const ss = Math.floor((remainMs % 60000) / 1000);
  const pct = totalSec > 0 ? (remainMs / (totalSec * 1000)) * 100 : 0;

  return (
    <div className="text-center py-6">
      <div
        className={`mx-auto max-w-2xl rounded-2xl border-4 py-10 transition-colors ${
          finished
            ? "border-red-500 bg-red-50 animate-pulse"
            : pct < 15 && running
              ? "border-red-400 bg-red-50/50"
              : "border-border-default bg-bg-secondary/40"
        }`}
      >
        <div className={`font-mono font-extrabold tracking-wider ${finished ? "text-red-600" : ""}`} style={{ fontSize: "min(18vw, 130px)", lineHeight: 1 }}>
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </div>
        {finished && <div className="text-title font-bold text-red-600 mt-2">시간 종료!</div>}
      </div>

      <div className="h-2.5 bg-bg-secondary rounded-full overflow-hidden max-w-2xl mx-auto mt-4">
        <div
          className={`h-full transition-[width] ${pct < 15 ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>

      <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
        {TIMER_PRESETS.map((s) => (
          <button
            key={s}
            onClick={() => reset(s)}
            className={`px-3 py-1.5 rounded-lg border text-caption ${
              totalSec === s ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold" : "border-border-default hover:bg-bg-secondary"
            }`}
          >
            {s % 60 === 0 ? `${s / 60}분` : `${s}초`}
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={180}
          placeholder="분"
          onChange={(e) => {
            const m = parseInt(e.target.value, 10);
            if (m > 0) reset(m * 60);
          }}
          className="w-16 px-2 py-1.5 border border-border-default rounded-lg text-caption text-center outline-none focus:border-emerald-500"
        />
      </div>

      <div className="flex items-center justify-center gap-3 mt-5">
        {!running ? (
          <button
            onClick={start}
            disabled={remainMs <= 0}
            className="inline-flex items-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-lg font-semibold"
          >
            <Play size={20} /> 시작
          </button>
        ) : (
          <button
            onClick={pause}
            className="inline-flex items-center gap-2 px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-lg font-semibold"
          >
            <Pause size={20} /> 일시정지
          </button>
        )}
        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 px-4 py-3 border border-border-default rounded-xl text-body hover:bg-bg-secondary"
        >
          <RotateCcw size={15} /> 리셋
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 신호등
// ─────────────────────────────────────────────────────────────────────────────

const LIGHTS = [
  { key: "red", color: "bg-red-500", ring: "ring-red-300", label: "조용히 — 개인 활동" },
  { key: "yellow", color: "bg-amber-400", ring: "ring-amber-300", label: "소곤소곤 — 짝 활동" },
  { key: "green", color: "bg-emerald-500", ring: "ring-emerald-300", label: "자유롭게 — 모둠 활동" },
] as const;

function TrafficLightTool() {
  const [active, setActive] = useState<string>("red");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "1") setActive("red");
      if (e.key === "2") setActive("yellow");
      if (e.key === "3") setActive("green");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = LIGHTS.find((l) => l.key === active)!;

  return (
    <div className="text-center py-8">
      <div className="inline-flex flex-col gap-5 bg-gray-800 rounded-3xl px-8 py-8">
        {LIGHTS.map((l) => (
          <button
            key={l.key}
            onClick={() => setActive(l.key)}
            className={`w-28 h-28 sm:w-36 sm:h-36 rounded-full transition-all ${l.color} ${
              active === l.key
                ? `opacity-100 ring-8 ${l.ring} scale-105`
                : "opacity-25 hover:opacity-50"
            }`}
            title={l.label}
          />
        ))}
      </div>
      <div className="text-title font-bold mt-6">{current.label}</div>
      <div className="text-caption text-text-tertiary mt-2">키보드 1 / 2 / 3 으로도 전환</div>
    </div>
  );
}
