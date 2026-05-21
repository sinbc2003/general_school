"use client";

import { colorAt } from "./palette";

interface Slice {
  label: string;
  value: number;
}

/**
 * SVG 파이차트 + 우측 범례. Google Forms 객관식 결과 스타일.
 *
 * - radius 120, center (130,130) 기준.
 * - 1개 슬라이스(100%)일 땐 circle full, 0건이면 회색 원 + "응답 없음".
 * - 슬라이스 라벨은 5% 이상일 때만 그림 (작은 조각엔 안 그림).
 */
export function PieChart({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-caption text-text-tertiary">
        아직 응답 없음
      </div>
    );
  }

  const cx = 130;
  const cy = 130;
  const r = 120;
  // accumulator 각도 (radian)
  let acc = -Math.PI / 2; // 12시 방향에서 시작

  const paths = slices
    .map((s, i) => {
      if (s.value <= 0) return null;
      const angle = (s.value / total) * Math.PI * 2;
      const start = acc;
      const end = acc + angle;
      acc = end;

      // 단일 슬라이스(100%)일 때는 원 전체
      if (s.value === total) {
        return {
          path: `M ${cx},${cy - r} A ${r},${r} 0 1 1 ${cx - 0.01},${cy - r} Z`,
          color: colorAt(i),
          pct: 100,
          midAngle: 0,
          label: s.label,
        };
      }

      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const largeArc = angle > Math.PI ? 1 : 0;
      const midAngle = (start + end) / 2;
      const pct = Math.round((s.value / total) * 100);
      return {
        path: `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`,
        color: colorAt(i),
        pct,
        midAngle,
        label: s.label,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return (
    <div className="flex items-center gap-6 flex-wrap justify-center">
      <svg viewBox="0 0 260 260" width={260} height={260} className="flex-shrink-0">
        {paths.map((p, i) => (
          <g key={i}>
            <path d={p.path} fill={p.color} stroke="white" strokeWidth={1.5} />
            {p.pct >= 5 && p.label !== undefined && (
              <text
                x={cx + (r * 0.65) * Math.cos(p.midAngle)}
                y={cy + (r * 0.65) * Math.sin(p.midAngle)}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={14}
                fontWeight={500}
                style={{ pointerEvents: "none" }}
              >
                {p.pct}%
              </text>
            )}
          </g>
        ))}
      </svg>
      {/* 범례 */}
      <ul className="text-caption space-y-1 min-w-[120px]">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: colorAt(i) }}
            />
            <span className="truncate max-w-[180px]" title={s.label}>{s.label}</span>
            <span className="text-text-tertiary ml-auto tabular-nums">
              {s.value}
              {total > 0 && ` (${Math.round((s.value / total) * 100)}%)`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
