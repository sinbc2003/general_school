"use client";

/**
 * 실시간 투표 결과 시각화 — 호스트·학생 화면 공유.
 *
 * - ChoiceBars: Mentimeter식 세로 막대 (보기별 카운트 + 퍼센트, 부드러운 전환)
 * - WordCloudView: 빈도 가중 워드클라우드 (단어 해시 기반 색·기울기 — 폴링마다 안 흔들림)
 */

export interface ChoiceResults {
  type: "choice";
  counts: Record<string, number>;
  respondents: number;
}

export interface WordcloudResults {
  type: "wordcloud";
  words: { text: string; count: number }[];
  respondents: number;
}

export type PollResultsData = ChoiceResults | WordcloudResults;

export interface PollQuestion {
  id: string;
  type: "choice" | "wordcloud";
  prompt: string;
  options?: string[];
  multi?: boolean;
  max_words?: number;
}

const BAR_COLORS = [
  "#0d9488", "#6366f1", "#f59e0b", "#ec4899", "#0ea5e9",
  "#84cc16", "#a855f7", "#f97316", "#14b8a6", "#64748b",
];

const WORD_COLORS = [
  "#0f766e", "#4f46e5", "#b45309", "#be185d", "#0369a1",
  "#4d7c0f", "#7e22ce", "#c2410c",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function ChoiceBars({
  question, results, compact = false,
}: {
  question: PollQuestion;
  results: ChoiceResults;
  compact?: boolean;
}) {
  const options = question.options || [];
  const counts = options.map((_, i) => results.counts[String.fromCharCode(65 + i)] || 0);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const barArea = compact ? 120 : 260;

  return (
    <div>
      <div className="flex items-end justify-center gap-3 sm:gap-5" style={{ height: barArea + 64 }}>
        {options.map((opt, i) => {
          const cnt = counts[i];
          const pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
          const h = Math.max(6, (cnt / max) * barArea);
          return (
            <div key={i} className="flex flex-col items-center justify-end flex-1 min-w-0 max-w-[140px] h-full">
              <div className={`font-bold text-text-primary ${compact ? "text-sm" : "text-xl"}`}>
                {cnt}
                {total > 0 && (
                  <span className={`text-text-tertiary font-normal ml-1 ${compact ? "text-[10px]" : "text-caption"}`}>
                    {pct}%
                  </span>
                )}
              </div>
              <div
                className="w-full rounded-t-lg transition-[height] duration-500 ease-out"
                style={{ height: h, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
              />
              <div
                className={`mt-2 text-center text-text-secondary leading-tight w-full break-keep ${
                  compact ? "text-[10px]" : "text-caption"
                }`}
                style={{ minHeight: compact ? 24 : 32 }}
              >
                {opt}
              </div>
            </div>
          );
        })}
      </div>
      <div className={`text-center text-text-tertiary mt-1 ${compact ? "text-[10px]" : "text-caption"}`}>
        {results.respondents}명 참여
      </div>
    </div>
  );
}

export function WordCloudView({
  results, compact = false,
}: {
  results: WordcloudResults;
  compact?: boolean;
}) {
  const words = results.words || [];
  if (words.length === 0) {
    return (
      <div className={`text-center text-text-tertiary py-12 ${compact ? "text-caption" : "text-body"}`}>
        아직 제출된 단어가 없습니다
      </div>
    );
  }
  const max = Math.max(1, ...words.map((w) => w.count));
  const min = Math.min(...words.map((w) => w.count));
  const lo = compact ? 12 : 16;
  const hi = compact ? 30 : 56;

  return (
    <div>
      <div
        className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 ${
          compact ? "py-3 px-2" : "py-8 px-4"
        }`}
      >
        {words.map((w) => {
          const t = max === min ? 1 : (w.count - min) / (max - min);
          const size = lo + t * (hi - lo);
          const h = hashStr(w.text);
          const color = WORD_COLORS[h % WORD_COLORS.length];
          const rot = (h % 3) - 1; // -1 | 0 | 1 deg — 살짝만
          return (
            <span
              key={w.text}
              title={`${w.count}회`}
              className="font-bold leading-none transition-all duration-500"
              style={{
                fontSize: size,
                color,
                transform: `rotate(${rot * 2}deg)`,
                opacity: 0.55 + t * 0.45,
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
      <div className={`text-center text-text-tertiary ${compact ? "text-[10px]" : "text-caption"}`}>
        {results.respondents}명 참여
      </div>
    </div>
  );
}

export function PollResultsView({
  question, results, compact = false,
}: {
  question: PollQuestion;
  results: PollResultsData;
  compact?: boolean;
}) {
  if (results.type === "choice") {
    return <ChoiceBars question={question} results={results} compact={compact} />;
  }
  return <WordCloudView results={results} compact={compact} />;
}
