"use client";

/**
 * 디자인 테마 선택 modal — 8종 카드 grid.
 *
 * 사용:
 *   <ThemePicker
 *     current={deck.settings.theme_id}
 *     onPick={(id) => api.put(`/api/classroom/decks/${did}`, { settings: {...settings, theme_id: id}})}
 *     onClose={...}
 *   />
 */

import { X, Check } from "lucide-react";
import { THEMES, type DeckTheme } from "./themes";

interface ThemePickerProps {
  current?: string | null;
  onPick: (themeId: string) => void;
  onClose: () => void;
}

export function ThemePicker({ current, onPick, onClose }: ThemePickerProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h2 className="text-body font-semibold">디자인 테마</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded-full">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              active={t.id === current}
              onClick={() => { onPick(t.id); onClose(); }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme, active, onClick,
}: { theme: DeckTheme; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border rounded-lg overflow-hidden text-left transition hover:shadow-md ${
        active ? "border-accent ring-2 ring-accent" : "border-border-default"
      }`}
    >
      {/* 미리보기 — 실제 슬라이드 스타일 적용 */}
      <div
        className="aspect-video flex items-center justify-center relative"
        style={theme.slideStyle}
      >
        <div className="text-center px-3" style={{ color: theme.slideStyle.color }}>
          <div className="text-[11px] opacity-70 mb-1">SLIDE TITLE</div>
          <div className="text-body font-bold">{theme.label}</div>
          <div
            className="inline-block mt-2 px-2 py-0.5 rounded text-[10px]"
            style={{ backgroundColor: theme.accent, color: "#fff" }}
          >
            accent
          </div>
        </div>
        {active && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center">
            <Check size={12} />
          </div>
        )}
      </div>
      {/* 메타 */}
      <div className="px-3 py-2 bg-bg-primary border-t border-border-default">
        <div className="flex items-center justify-between">
          <div className="text-caption font-medium text-text-primary">{theme.label}</div>
          <div className="flex gap-0.5">
            {theme.swatch.map((c, i) => (
              <span
                key={i}
                className="w-3 h-3 rounded-full border border-border-default"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="text-[11px] text-text-tertiary mt-0.5 truncate">{theme.desc}</div>
      </div>
    </button>
  );
}
