"use client";

/**
 * 단어장 학습 화면 — 교사 미리보기(/tools/wordbook/[did])와
 * 학생(/s/wordbook/[did]) 양쪽에서 공유.
 *
 * 모드 3종:
 *  - flash  : 플래시카드 (카드 뒤집기 → 알아요/몰라요 자가 평가)
 *  - choice : 4지선다 (단어 → 뜻 고르기, 다른 카드 뜻이 오답 보기)
 *  - spell  : 스펠 타이핑 (뜻 → 단어 입력)
 *
 * 세션 구성: 라이트너 box 낮은 순 → 오답 많은 순 → 안 본 지 오래된 순으로
 * N개 선택 후 셔플. 답마다 POST progress (box 갱신).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, BookA, Layers, ListChecks, Keyboard, CheckCircle2, XCircle,
  RotateCcw, ChevronRight, Trophy,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface Card { id: number; term: string; meaning: string; example?: string | null }
interface CardState { box: number; correct_count: number; wrong_count: number; last_seen: string | null }

interface StudyData {
  id: number;
  title: string;
  description?: string | null;
  lang_pair: string;
  card_count: number;
  cards: Card[];
  states: Record<string, CardState>;
}

type Mode = "flash" | "choice" | "spell";

const MODE_DEFS: { key: Mode; label: string; desc: string; icon: any }[] = [
  { key: "flash", label: "플래시카드", desc: "카드를 뒤집으며 암기", icon: Layers },
  { key: "choice", label: "4지선다", desc: "단어를 보고 뜻 고르기", icon: ListChecks },
  { key: "spell", label: "스펠 타이핑", desc: "뜻을 보고 단어 입력", icon: Keyboard },
];

/** 예문에서 정답 단어를 ____로 가림 (regex 특수문자 안전) */
function blankOut(example: string, term: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return example.replace(new RegExp(escaped, "gi"), "____");
  } catch {
    return example;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function StudyView({ deckId }: { deckId: number }) {
  const [data, setData] = useState<StudyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [sessionSize, setSessionSize] = useState(20);

  const load = useCallback(async () => {
    try {
      const res = await api.get<StudyData>(`/api/tools/wordbook/decks/${deckId}/study`);
      setData(res);
    } catch (e: any) {
      setError(e?.detail || "단어장을 불러올 수 없습니다");
    }
  }, [deckId]);

  useEffect(() => { load(); }, [load]);

  // 진도 요약 (box 분포)
  const progress = useMemo(() => {
    if (!data) return null;
    const dist = [0, 0, 0, 0, 0]; // box 1~5
    let studied = 0;
    for (const c of data.cards) {
      const s = data.states[String(c.id)];
      if (s) {
        studied++;
        dist[Math.min(5, Math.max(1, s.box)) - 1]++;
      } else {
        dist[0]++;
      }
    }
    const mastered = dist[4];
    return { studied, mastered, dist, total: data.cards.length };
  }, [data]);

  const startSession = (m: Mode) => {
    if (!data || data.cards.length === 0) return;
    // 우선순위: box 낮음 → 오답 많음 → 오래 안 봄(없으면 최우선)
    const ranked = [...data.cards].sort((a, b) => {
      const sa = data.states[String(a.id)];
      const sb = data.states[String(b.id)];
      const boxA = sa?.box ?? 0;
      const boxB = sb?.box ?? 0;
      if (boxA !== boxB) return boxA - boxB;
      const wrongA = sa?.wrong_count ?? 0;
      const wrongB = sb?.wrong_count ?? 0;
      if (wrongA !== wrongB) return wrongB - wrongA;
      const seenA = sa?.last_seen ? new Date(sa.last_seen).getTime() : 0;
      const seenB = sb?.last_seen ? new Date(sb.last_seen).getTime() : 0;
      return seenA - seenB;
    });
    setSessionCards(shuffle(ranked.slice(0, sessionSize)));
    setMode(m);
  };

  const endSession = () => {
    setMode(null);
    setSessionCards([]);
    load(); // 진도 갱신
  };

  if (error) {
    return <div className="p-8 text-center text-body text-status-error">{error}</div>;
  }
  if (!data || !progress) {
    return (
      <div className="flex items-center justify-center py-20 text-text-tertiary">
        <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  if (mode) {
    return (
      <StudySession
        deckId={deckId}
        mode={mode}
        cards={sessionCards}
        allCards={data.cards}
        onExit={endSession}
      />
    );
  }

  // ── 모드 선택 화면 ──────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <BookA size={36} className="mx-auto text-sky-600 mb-2" />
        <h2 className="text-title font-semibold">{data.title}</h2>
        {data.description && (
          <p className="text-caption text-text-tertiary mt-1">{data.description}</p>
        )}
        <div className="text-caption text-text-secondary mt-2">
          {progress.total}개 단어 · 학습 {progress.studied}개 · 마스터(5단계) {progress.mastered}개
        </div>
        {/* box 분포 바 */}
        <div className="flex h-2.5 rounded-full overflow-hidden max-w-sm mx-auto mt-2 bg-bg-secondary">
          {progress.dist.map((n, i) => {
            const colors = ["bg-gray-300", "bg-amber-400", "bg-yellow-400", "bg-lime-400", "bg-emerald-500"];
            return n > 0 ? (
              <div
                key={i}
                className={colors[i]}
                style={{ width: `${(n / progress.total) * 100}%` }}
                title={`${i + 1}단계: ${n}개`}
              />
            ) : null;
          })}
        </div>
      </div>

      {data.cards.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary text-caption">
          이 단어장에는 아직 카드가 없습니다.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center gap-2 mb-4 text-caption text-text-secondary">
            한 번에
            <select
              value={sessionSize}
              onChange={(e) => setSessionSize(Number(e.target.value))}
              className="px-2 py-1 border border-border-default rounded bg-bg-primary"
            >
              <option value={10}>10개</option>
              <option value={20}>20개</option>
              <option value={50}>50개</option>
              <option value={10000}>전체</option>
            </select>
            학습 (틀린 것·안 본 것 우선)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MODE_DEFS.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => startSession(m.key)}
                  className="border border-border-default rounded-xl p-5 bg-bg-primary hover:border-sky-400 hover:shadow-md transition text-center"
                >
                  <Icon size={26} className="mx-auto text-sky-600 mb-2" />
                  <div className="text-body font-semibold">{m.label}</div>
                  <div className="text-caption text-text-tertiary mt-1">{m.desc}</div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 학습 세션
// ─────────────────────────────────────────────────────────────────────────────

function StudySession({
  deckId, mode, cards, allCards, onExit,
}: {
  deckId: number;
  mode: Mode;
  cards: Card[];
  allCards: Card[];
  onExit: () => void;
}) {
  const [queue, setQueue] = useState<Card[]>(cards);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<{ card: Card; correct: boolean }[]>([]);

  const current = queue[idx];
  const done = idx >= queue.length;

  const record = useCallback(async (card: Card, correct: boolean) => {
    setResults((r) => [...r, { card, correct }]);
    try {
      await api.post(`/api/tools/wordbook/decks/${deckId}/progress`, {
        card_id: card.id, correct,
      });
    } catch { /* 진도 기록 실패는 학습 진행에 영향 X */ }
  }, [deckId]);

  const next = () => setIdx((i) => i + 1);

  const retryWrong = () => {
    const wrong = results.filter((r) => !r.correct).map((r) => r.card);
    if (wrong.length === 0) return;
    setQueue(shuffle(wrong));
    setIdx(0);
    setResults([]);
  };

  if (done) {
    const correct = results.filter((r) => r.correct).length;
    const wrong = results.filter((r) => !r.correct);
    return (
      <div className="max-w-md mx-auto text-center py-8">
        <Trophy size={36} className="mx-auto text-amber-500 mb-3" />
        <div className="text-title font-bold mb-1">
          {correct} / {results.length} 정답
        </div>
        {wrong.length > 0 && (
          <div className="mt-4 border border-border-default rounded-xl p-4 bg-bg-primary text-left">
            <div className="text-caption font-semibold text-text-secondary mb-2">틀린 단어</div>
            <ul className="space-y-1">
              {wrong.map((r, i) => (
                <li key={i} className="text-body flex justify-between gap-3">
                  <span className="font-medium">{r.card.term}</span>
                  <span className="text-text-secondary truncate">{r.card.meaning}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center justify-center gap-3 mt-6">
          {wrong.length > 0 && (
            <button
              onClick={retryWrong}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-body font-medium"
            >
              <RotateCcw size={15} /> 틀린 것만 다시
            </button>
          )}
          <button
            onClick={onExit}
            className="px-4 py-2 border border-border-default rounded-lg text-body hover:bg-bg-secondary"
          >
            완료
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <button onClick={onExit} className="text-caption text-text-tertiary hover:text-text-primary">
          ← 그만하기
        </button>
        <span className="text-caption text-text-secondary font-mono">
          {idx + 1} / {queue.length}
        </span>
      </div>
      <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden mb-5">
        <div
          className="h-full bg-sky-500 transition-[width]"
          style={{ width: `${(idx / queue.length) * 100}%` }}
        />
      </div>

      {mode === "flash" && <FlashCard key={current.id} card={current} onAnswer={(ok) => { record(current, ok); next(); }} />}
      {mode === "choice" && <ChoiceCard key={current.id} card={current} allCards={allCards} onAnswer={(ok) => { record(current, ok); }} onNext={next} />}
      {mode === "spell" && <SpellCard key={current.id} card={current} onAnswer={(ok) => { record(current, ok); }} onNext={next} />}
    </div>
  );
}

function FlashCard({ card, onAnswer }: { card: Card; onAnswer: (ok: boolean) => void }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div>
      <button
        onClick={() => setFlipped((f) => !f)}
        className="w-full min-h-[220px] border-2 border-border-default rounded-2xl bg-bg-primary flex flex-col items-center justify-center p-6 hover:border-sky-300 transition"
      >
        {!flipped ? (
          <>
            <div className="text-3xl font-bold">{card.term}</div>
            <div className="text-caption text-text-tertiary mt-3">탭하여 뜻 보기</div>
          </>
        ) : (
          <>
            <div className="text-2xl font-semibold text-sky-700">{card.meaning}</div>
            {card.example && (
              <div className="text-body text-text-secondary mt-3 italic">{card.example}</div>
            )}
            <div className="text-caption text-text-tertiary mt-3">{card.term}</div>
          </>
        )}
      </button>
      {flipped && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button
            onClick={() => onAnswer(false)}
            className="py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold inline-flex items-center justify-center gap-2"
          >
            <XCircle size={17} /> 몰라요
          </button>
          <button
            onClick={() => onAnswer(true)}
            className="py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold inline-flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={17} /> 알아요
          </button>
        </div>
      )}
    </div>
  );
}

function ChoiceCard({
  card, allCards, onAnswer, onNext,
}: {
  card: Card; allCards: Card[];
  onAnswer: (ok: boolean) => void; onNext: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  const options = useMemo(() => {
    const others = allCards.filter((c) => c.id !== card.id && c.meaning !== card.meaning);
    const distractors = shuffle(others).slice(0, 3).map((c) => c.meaning);
    return shuffle([card.meaning, ...distractors]);
  }, [card, allCards]);

  const pick = (m: string) => {
    if (picked) return;
    setPicked(m);
    const ok = m === card.meaning;
    onAnswer(ok);
    setTimeout(onNext, ok ? 700 : 1500);
  };

  return (
    <div>
      <div className="text-center border-2 border-border-default rounded-2xl bg-bg-primary p-8 mb-4">
        <div className="text-3xl font-bold">{card.term}</div>
        {card.example && (
          <div className="text-caption text-text-tertiary mt-2 italic">
            {blankOut(card.example, card.term)}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2.5">
        {options.map((m, i) => {
          const isCorrect = m === card.meaning;
          let cls = "border-border-default bg-bg-primary hover:border-sky-400";
          if (picked) {
            if (isCorrect) cls = "border-emerald-500 bg-emerald-50";
            else if (m === picked) cls = "border-red-500 bg-red-50";
            else cls = "border-border-default bg-bg-primary opacity-50";
          }
          return (
            <button
              key={i}
              onClick={() => pick(m)}
              disabled={!!picked}
              className={`border-2 rounded-xl px-4 py-3 text-left text-body transition ${cls}`}
            >
              {m}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SpellCard({
  card, onAnswer, onNext,
}: { card: Card; onAnswer: (ok: boolean) => void; onNext: () => void }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<"correct" | "wrong" | null>(null);

  const check = () => {
    if (result) return;
    const ok = input.trim().toLowerCase() === card.term.trim().toLowerCase();
    setResult(ok ? "correct" : "wrong");
    onAnswer(ok);
    setTimeout(onNext, ok ? 700 : 2000);
  };

  return (
    <div>
      <div className="text-center border-2 border-border-default rounded-2xl bg-bg-primary p-8 mb-4">
        <div className="text-2xl font-semibold text-sky-700">{card.meaning}</div>
        {card.example && (
          <div className="text-caption text-text-tertiary mt-2 italic">
            {blankOut(card.example, card.term)}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) check(); }}
          disabled={!!result}
          placeholder="단어 입력"
          autoFocus
          className={`flex-1 px-4 py-3 border-2 rounded-xl outline-none text-body ${
            result === "correct" ? "border-emerald-500 bg-emerald-50"
            : result === "wrong" ? "border-red-500 bg-red-50"
            : "border-border-default focus:border-sky-500"
          }`}
        />
        <button
          onClick={check}
          disabled={!input.trim() || !!result}
          className="px-5 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl font-semibold inline-flex items-center gap-1.5"
        >
          확인 <ChevronRight size={15} />
        </button>
      </div>
      {result === "wrong" && (
        <div className="text-center text-body mt-3">
          정답: <span className="font-bold text-red-600">{card.term}</span>
        </div>
      )}
      {result === "correct" && (
        <div className="text-center text-body mt-3 text-emerald-600 font-semibold">정답!</div>
      )}
    </div>
  );
}
