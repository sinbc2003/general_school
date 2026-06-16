"use client";

/**
 * 업무 도구 허브 — PDF→HWPX 변환 / PDF 번역.
 *
 * cmd센터의 pdf2hwpx(#008) + PDF 번역(#007)을 플랫폼 네이티브로 이식.
 * 수업 도구(/tools)와 동일한 카드 그리드 + 미니 목업 스타일.
 */

import Link from "next/link";
import { FileType2, Languages, ExternalLink, type LucideIcon } from "lucide-react";
import { openToolWindow } from "@/lib/open-tool-window";
import { ToolsNav } from "../_ToolsNav";

interface ToolDef {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  href: string;
  preview: React.ReactNode;
}

function HwpxPreview() {
  return (
    <div className="h-full bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center gap-3 px-3">
      {/* PDF 카드 */}
      <div className="w-12 h-16 bg-white rounded border border-rose-200 shadow-sm relative">
        <div className="absolute top-1 left-1 right-1 h-1 rounded bg-rose-300" />
        <div className="absolute top-3 left-1 right-2 space-y-0.5">
          <div className="h-0.5 bg-slate-200 rounded" />
          <div className="h-0.5 bg-slate-200 rounded w-2/3" />
        </div>
        <span className="absolute bottom-1 left-1 text-[6px] font-bold text-rose-500">PDF</span>
      </div>
      {/* 화살표 + 수식 */}
      <div className="flex flex-col items-center text-blue-400">
        <span className="text-[10px] font-mono leading-none">∑√x²</span>
        <span className="text-lg leading-none">→</span>
      </div>
      {/* HWPX 카드 */}
      <div className="w-12 h-16 bg-white rounded border border-blue-300 shadow-sm relative">
        <div className="absolute top-1 left-1 right-1 h-1 rounded bg-blue-400" />
        <div className="absolute top-3 left-1 right-2 space-y-0.5">
          <div className="h-0.5 bg-slate-200 rounded" />
          <div className="h-0.5 bg-slate-200 rounded w-3/4" />
        </div>
        <span className="absolute bottom-1 left-1 text-[6px] font-bold text-blue-600">HWPX</span>
      </div>
    </div>
  );
}

function TranslatePreview() {
  return (
    <div className="h-full bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center gap-2.5 px-3">
      <div className="w-14 h-16 bg-white rounded border border-slate-200 shadow-sm p-1.5 space-y-1">
        <div className="text-[6px] text-slate-400 font-semibold">EN</div>
        <div className="h-0.5 bg-slate-200 rounded" />
        <div className="h-0.5 bg-slate-200 rounded w-3/4" />
        <div className="h-0.5 bg-slate-200 rounded w-5/6" />
      </div>
      <Languages size={16} className="text-teal-500" />
      <div className="w-14 h-16 bg-white rounded border border-teal-300 shadow-sm p-1.5 space-y-1">
        <div className="text-[6px] text-teal-600 font-semibold">한국어</div>
        <div className="h-0.5 bg-teal-200 rounded" />
        <div className="h-0.5 bg-teal-200 rounded w-3/4" />
        <div className="h-0.5 bg-teal-200 rounded w-5/6" />
      </div>
    </div>
  );
}

const TOOLS: ToolDef[] = [
  {
    key: "pdf-hwpx",
    name: "PDF → HWPX 변환",
    description: "PDF(특히 수학 시험지)를 한글 문서(HWPX)로 변환 — 수식까지 한컴 수식으로 인식 (Mathpix OCR)",
    icon: FileType2,
    iconColor: "#2563eb",
    href: "/tools/work/pdf-hwpx",
    preview: <HwpxPreview />,
  },
  {
    key: "translate",
    name: "PDF 번역",
    description: "PDF 문서를 페이지별로 추출해 한국어 등으로 번역 — 학교에 등록된 AI 모델 사용",
    icon: Languages,
    iconColor: "#0d9488",
    href: "/tools/work/translate",
    preview: <TranslatePreview />,
  },
];

export default function WorkToolsHubPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <ToolsNav active="work" />
      <header className="mb-6">
        <h1 className="text-title font-semibold">업무 도구</h1>
        <p className="text-caption text-text-tertiary mt-1">
          교사 업무용 변환·번역 도구 — 결과 파일은 본인만 다운로드할 수 있습니다.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.key} href={t.href} className="block h-full">
              <div className="group relative h-full border border-border-default rounded-xl overflow-hidden bg-bg-primary transition hover:shadow-lg hover:-translate-y-0.5 hover:border-border-strong cursor-pointer">
                <div className="h-28 relative border-b border-border-default/60">
                  {t.preview}
                  <span
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openToolWindow(t.href);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 hover:bg-white text-gray-700 shadow-sm opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    title="새 창에서 열기"
                  >
                    <ExternalLink size={13} />
                  </span>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <Icon size={16} style={{ color: t.iconColor }} className="flex-shrink-0" />
                    <div className="text-body font-semibold">{t.name}</div>
                  </div>
                  <p className="text-caption text-text-secondary mt-1.5 leading-relaxed">
                    {t.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
