"use client";

/**
 * 자리표 인쇄 — A4 교탁 게시용.
 *
 * 칠판·교탁·출입문 위치까지 그려 교탁에 붙여두고 보는 용도.
 * "교탁에서 본 방향"은 칠판을 아래로 + 좌우 반전 → 교사가 교탁에서 들고 봤을 때 일치.
 *
 * 인쇄 시 사이드바·툴바를 숨기는 트릭: body 전부 visibility:hidden →
 * #print-root만 visible.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Printer, Loader2, FlipHorizontal2, FlipVertical2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { Chart, normalizeChart } from "../../_shared";
import RoomChart from "../_components/RoomChart";

export default function SeatingPrintPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [chart, setChart] = useState<Chart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teacherView, setTeacherView] = useState(false); // 교탁에서 본 방향
  const [landscape, setLandscape] = useState(true);
  const [scale, setScale] = useState(1);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        setChart(normalizeChart(await api.get(`/api/tools/seating/${id}`)));
      } catch (e: any) {
        setError(e?.detail || "불러올 수 없습니다");
      }
    })();
  }, [id]);

  // A4 안에 맞도록 자동 축소 (offsetWidth는 transform 영향 없음)
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;
    const availW = (landscape ? 1122 : 793) - 30;
    const availH = (landscape ? 793 : 1122) - 120;
    const s = Math.min(availW / w, availH / h, 1.5);
    setScale(s > 0 && isFinite(s) ? s : 1);
  }, [chart, landscape, teacherView]);

  const flipH = teacherView;
  const flipV = teacherView;
  const dateStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  const printCss = `
    @media print {
      body * { visibility: hidden !important; }
      #print-root, #print-root * { visibility: visible !important; }
      #print-root { position: absolute !important; left: 0; top: 0; width: 100%; margin: 0; box-shadow: none !important; border: none !important; }
      @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 8mm; }
    }
  `;

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href={`/tools/seating/${id}`} className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary"><ChevronLeft size={14} /> 편집기로</Link>
        <div className="mt-6 text-center text-rose-600">{error}</div>
      </div>
    );
  }
  if (!chart) {
    return <div className="p-10 text-center text-text-tertiary"><Loader2 className="animate-spin inline" /> 불러오는 중...</div>;
  }

  return (
    <div className="p-6">
      <style dangerouslySetInnerHTML={{ __html: printCss }} />

      {/* 컨트롤 (인쇄 시 숨김 — #print-root 밖) */}
      <div className="no-print flex flex-wrap items-center gap-2 mb-5 max-w-4xl mx-auto">
        <Link href={`/tools/seating/${id}`} className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mr-2">
          <ChevronLeft size={14} /> 편집기로
        </Link>
        <button
          onClick={() => setTeacherView((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-body ${
            teacherView ? "border-teal-400 bg-teal-50 text-teal-700" : "border-border-default hover:bg-bg-secondary"
          }`}
          title="칠판을 아래로 + 좌우 반전"
        >
          <FlipVertical2 size={15} /> {teacherView ? "교탁에서 본 방향" : "학생 방향"}
        </button>
        <button
          onClick={() => setLandscape((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border-default hover:bg-bg-secondary text-body"
        >
          <FlipHorizontal2 size={15} /> {landscape ? "가로" : "세로"}
        </button>
        <button
          onClick={() => window.print()}
          className="ml-auto inline-flex items-center gap-1.5 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-body font-medium"
        >
          <Printer size={16} /> 인쇄
        </button>
      </div>

      {/* A4 미리보기 / 인쇄 영역 */}
      <div
        id="print-root"
        className="mx-auto bg-white border border-border-default shadow-sm"
        style={{
          width: landscape ? 1122 : 793,
          minHeight: landscape ? 793 : 1122,
          maxWidth: "100%",
          padding: "12mm",
        }}
      >
        <div className="flex items-baseline justify-between mb-4 border-b border-slate-300 pb-2">
          <h1 className="text-2xl font-bold text-slate-800">{chart.title}</h1>
          <span className="text-sm text-slate-500">{dateStr}</span>
        </div>

        <div className="flex justify-center" style={{ height: (innerRef.current?.offsetHeight ?? 0) * scale || undefined }}>
          <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}>
            <RoomChart
              layout={chart.layout}
              roster={chart.roster}
              assignment={chart.assignment}
              mode="print"
              flipH={flipH}
              flipV={flipV}
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-900 inline-block" /> 칠판</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-amber-300 bg-amber-50 inline-block" /> 교탁</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-amber-300 bg-amber-100 inline-block" /> 출입문</span>
          <span>· {flipV ? "교탁에서 본 방향" : "학생 방향 (칠판이 위)"}</span>
        </div>
      </div>
    </div>
  );
}
