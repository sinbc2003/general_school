"use client";

import { ACCENT } from "./palette";

interface Bar {
  label: string;
  value: number;
}

/**
 * SVG 세로 막대 차트. Google Forms 단답형/평점 분포 스타일.
 *
 * - 각 막대 위에 "N (xx%)" 라벨
 * - x축 라벨 자동 회전 (라벨이 많거나 길 때)
 * - 최댓값에 맞춰 자동 스케일
 */
export function BarChart({
  bars,
  color = ACCENT,
  showPercent = true,
}: {
  bars: Bar[];
  color?: string;
  showPercent?: boolean;
}) {
  const total = bars.reduce((s, x) => s + x.value, 0);

  if (total === 0 || bars.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-caption text-text-tertiary">
        아직 응답 없음
      </div>
    );
  }

  const max = Math.max(...bars.map((b) => b.value), 1);
  // y축 눈금: 최댓값까지 적당히 — 1,2,3 또는 5단위
  const niceMax = Math.max(max, niceTop(max));

  const width = Math.max(420, bars.length * 80);
  const height = 280;
  const padL = 36;
  const padR = 16;
  const padT = 30;
  const padB = 60;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const barGap = 12;
  const barW = Math.max(20, Math.min(80, (innerW - barGap * (bars.length - 1)) / Math.max(1, bars.length)));

  // y축 4개 라인
  const yLines = Array.from({ length: 5 }, (_, i) => i * (niceMax / 4));

  // x축 라벨 회전 여부 (글자 평균 길이 + 막대 폭)
  const avgLabelLen = bars.reduce((s, b) => s + b.label.length, 0) / bars.length;
  const rotate = avgLabelLen * 7 > barW || bars.length > 8;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ maxWidth: width, minWidth: 360 }}
      >
        {/* 가로 grid */}
        {yLines.map((y, i) => {
          const yPos = padT + innerH - (y / niceMax) * innerH;
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={width - padR}
                y1={yPos}
                y2={yPos}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={yPos + 4}
                textAnchor="end"
                fontSize={11}
                fill="#9ca3af"
              >
                {Math.round(y)}
              </text>
            </g>
          );
        })}
        {/* 막대 */}
        {bars.map((b, i) => {
          const h = (b.value / niceMax) * innerH;
          const x = padL + i * (barW + barGap);
          const y = padT + innerH - h;
          const pct = total > 0 ? Math.round((b.value / total) * 100) : 0;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                fill={color}
                rx={2}
              />
              {/* 위쪽 라벨 */}
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={12}
                fill="white"
                fontWeight={500}
                style={{
                  // 막대 안쪽에 흰 글씨로
                  display: h < 20 ? "none" : undefined,
                }}
              >
                <tspan x={x + barW / 2} dy={18}>
                  {showPercent ? `${b.value} (${pct}%)` : b.value}
                </tspan>
              </text>
              {/* 막대가 너무 짧으면 위에 검정 글씨 */}
              {h < 20 && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#374151"
                  fontWeight={500}
                >
                  {showPercent ? `${b.value} (${pct}%)` : b.value}
                </text>
              )}
              {/* x축 라벨 */}
              <text
                x={x + barW / 2}
                y={padT + innerH + 16}
                textAnchor={rotate ? "end" : "middle"}
                fontSize={11}
                fill="#374151"
                transform={
                  rotate
                    ? `rotate(-30, ${x + barW / 2}, ${padT + innerH + 16})`
                    : undefined
                }
              >
                {b.label.length > 14 ? b.label.slice(0, 14) + "…" : b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceTop(n: number): number {
  if (n <= 4) return 4;
  if (n <= 10) return 10;
  if (n <= 20) return 20;
  if (n <= 50) return 50;
  if (n <= 100) return 100;
  return Math.ceil(n / 100) * 100;
}
