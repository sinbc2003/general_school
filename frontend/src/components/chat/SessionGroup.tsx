"use client";

/**
 * 챗봇 사이드바 세션 그룹 — 핀 고정 / 최근 / 보관 등을 라벨로 묶어 출력.
 *
 * 마우스 호버 시 이름 변경·삭제 버튼이 노출되고, 인라인 편집 입력칸으로 전환된다.
 */

import { Check, GraduationCap, MessageSquare, Pencil, Trash2, X } from "lucide-react";
import type { Session } from "./_chat-styles";
import { C as DefaultPalette, type ChatPalette } from "./_chat-styles";

interface Props {
  label: string;
  sessions: Session[];
  activeId: number | null;
  setActiveId: (id: number) => void;
  hoveredSession: number | null;
  setHoveredSession: (id: number | null) => void;
  editTitleId: number | null;
  setEditTitleId: (id: number | null) => void;
  editTitleVal: string;
  setEditTitleVal: (val: string) => void;
  renameSession: (id: number) => void;
  deleteSession: (id: number) => void;
  C?: ChatPalette;
}

export function SessionGroup({
  label, sessions, activeId, setActiveId, hoveredSession, setHoveredSession,
  editTitleId, setEditTitleId, editTitleVal, setEditTitleVal,
  renameSession, deleteSession,
  C = DefaultPalette,
}: Props) {
  if (sessions.length === 0) return null;
  return (
    <div className="mb-3">
      <div className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${C.textSubtle}`}>
        {label}
      </div>
      {sessions.map((s) => {
        const isCourseBot = !!s.source_chatbot_id;
        return (
        <div
          key={s.id}
          onMouseEnter={() => setHoveredSession(s.id)}
          onMouseLeave={() => setHoveredSession(null)}
          onClick={() => editTitleId !== s.id && setActiveId(s.id)}
          className={`group mx-1 px-2 py-1.5 rounded cursor-pointer flex items-start gap-1.5 ${
            activeId === s.id ? C.bgItemActive : C.bgItem
          } ${
            isCourseBot
              ? "border-l-[3px] border-l-amber-400 bg-amber-50/40"
              : ""
          }`}
          title={isCourseBot && s.source_course_name ? `강좌 챗봇 · ${s.source_course_name}` : undefined}
        >
          {editTitleId === s.id ? (
            <div className="flex-1 flex gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={editTitleVal}
                onChange={(e) => setEditTitleVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameSession(s.id);
                  if (e.key === "Escape") setEditTitleId(null);
                }}
                className={`flex-1 px-1 py-0.5 text-[12px] bg-white border ${C.border} rounded`}
              />
              <button onClick={() => renameSession(s.id)}><Check size={12} /></button>
              <button onClick={() => setEditTitleId(null)}><X size={12} /></button>
            </div>
          ) : (
            <>
              {isCourseBot ? (
                <GraduationCap
                  size={13}
                  className="flex-shrink-0 text-amber-600 mt-0.5"
                />
              ) : (
                <MessageSquare
                  size={12}
                  className={`flex-shrink-0 mt-0.5 ${C.textSubtle}`}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] truncate ${C.text}`}>{s.title}</div>
                {isCourseBot && s.source_course_name && (
                  <div className="text-[10.5px] text-amber-700 truncate leading-tight">
                    {s.source_course_name}
                  </div>
                )}
              </div>
              {hoveredSession === s.id && (
                <div className="flex gap-0.5 mt-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditTitleId(s.id); setEditTitleVal(s.title); }}
                    className={`p-0.5 rounded hover:bg-white/50 ${C.textMuted}`}
                    title="이름 변경"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    className={`p-0.5 rounded hover:bg-white/50 ${C.textMuted} hover:text-red-600`}
                    title="삭제"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        );
      })}
    </div>
  );
}
