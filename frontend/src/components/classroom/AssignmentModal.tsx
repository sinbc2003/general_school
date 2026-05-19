"use client";

/**
 * Google Classroom 식 풀스크린 과제·자료 생성 modal.
 *
 *  ┌────────────────────────────────────────────────────┬──────────────┐
 *  │ ✕  📋  과제                          [과제 만들기] ▼ │              │
 *  ├────────────────────────────────────────────────────┤  수업          │
 *  │ ┌────────────────────────────────────────────────┐ │  11 ▼         │
 *  │ │ 제목*                                           │ │              │
 *  │ │ 안내(선택)                                       │ │  할당 대상     │
 *  │ │ [B I U 목록 X]                                  │ │  👥 전체 학생   │
 *  │ └────────────────────────────────────────────────┘ │              │
 *  │ ┌────────────────────────────────────────────────┐ │  점수 100 ▼   │
 *  │ │ 첨부                                            │ │              │
 *  │ │ [📁 자료] [📺 링크] [📄 협업문서] [📊 설문]      │ │  기한 ▼       │
 *  │ └────────────────────────────────────────────────┘ │              │
 *  │                                                    │  주제 ▼       │
 *  │                                                    │              │
 *  └────────────────────────────────────────────────────┴──────────────┘
 *
 * 동일 컴포넌트로 "과제" / "자료" 두 모드 모두 처리 (kind prop).
 */

import { useState } from "react";
import {
  X, ClipboardList, Folder, FileText, ClipboardCheck, Link as LinkIcon,
  Trash2, Users, Award, Calendar, Hash,
} from "lucide-react";
import { api } from "@/lib/api/client";

export type CreateKind = "assignment" | "material";

interface AttachmentItem {
  type: "link" | "doc" | "survey";
  title: string;
  url?: string;
  doc_id?: number;
  survey_id?: number;
}

interface AssignmentModalProps {
  cid: number;
  kind: CreateKind;
  studentCount: number;
  /** 기존 주제 list (자동완성용) */
  existingTopics: string[];
  onClose: () => void;
  onSaved: (postId: number) => void;
}

const KIND_META: Record<CreateKind, { icon: any; iconBg: string; iconColor: string; title: string; submitLabel: string; postType: "assignment_ref" | "material" }> = {
  assignment: {
    icon: ClipboardList, iconBg: "#fef3c7", iconColor: "#a16207",
    title: "과제", submitLabel: "과제 만들기", postType: "assignment_ref",
  },
  material: {
    icon: Folder, iconBg: "#dcfce7", iconColor: "#15803d",
    title: "자료", submitLabel: "자료 게시", postType: "material",
  },
};

export function AssignmentModal({
  cid, kind, studentCount, existingTopics, onClose, onSaved,
}: AssignmentModalProps) {
  const meta = KIND_META[kind];

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [maxScore, setMaxScore] = useState<string>(kind === "assignment" ? "100" : "");
  const [dueDate, setDueDate] = useState(""); // YYYY-MM-DDTHH:MM
  const [topic, setTopic] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [saving, setSaving] = useState(false);

  const titleEmpty = !title.trim();

  const addLink = () => {
    const url = window.prompt("링크 URL:");
    if (!url) return;
    const t = window.prompt("표시할 제목:", url) || url;
    setAttachments([...attachments, { type: "link", url, title: t }]);
  };

  const addDoc = () => {
    const t = window.prompt("협업 문서 제목:");
    if (!t) return;
    // 실제 doc 생성은 별도 페이지. 여기는 placeholder
    alert("협업 문서는 별도 페이지에서 만들고 URL을 [링크] 첨부로 추가하세요.");
  };

  const addSurvey = () => {
    alert("설문은 별도 페이지에서 만들고 단축 링크를 [링크] 첨부로 추가하세요.");
  };

  const removeAttachment = (idx: number) => {
    setAttachments(attachments.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (titleEmpty) {
      alert("제목은 필수입니다");
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        title: title.trim(),
        content: content.trim() || title.trim(),  // backend가 content 필수 → 제목 fallback
        post_type: meta.postType,
        is_pinned: false,
      };
      if (maxScore && kind === "assignment") {
        body.max_score = Math.max(0, Math.min(10000, parseInt(maxScore, 10) || 0));
      }
      if (dueDate) body.due_date = new Date(dueDate).toISOString();
      if (topic.trim()) body.topic = topic.trim();
      if (attachments.length > 0) body.attachments = attachments;

      const res = await api.post<{ id: number }>(`/api/classroom/courses/${cid}/posts`, body);
      onSaved(res.id);
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 bg-bg-secondary flex flex-col">
      {/* 헤더 */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-primary">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-secondary rounded-full"
            title="닫기"
          >
            <X size={18} />
          </button>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: meta.iconBg, color: meta.iconColor }}
          >
            <Icon size={16} />
          </div>
          <h1 className="text-body font-medium">{meta.title}</h1>
        </div>
        <button
          onClick={submit}
          disabled={titleEmpty || saving}
          className="px-5 py-2 text-caption font-medium bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {saving ? "저장 중..." : meta.submitLabel}
        </button>
      </header>

      {/* 본문: grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-5 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">

          {/* 좌측 메인 */}
          <div className="space-y-3">
            <div className="bg-bg-primary border border-border-default rounded-lg p-5">
              <div className="bg-bg-secondary rounded px-3 py-2 mb-1">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="제목*"
                  className="w-full bg-transparent text-[15px] outline-none"
                  autoFocus
                />
              </div>
              {titleEmpty && (
                <div className="text-[11px] text-status-error px-1 mb-2">
                  *필수 입력란입니다
                </div>
              )}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="안내 (선택사항)"
                rows={6}
                className="w-full px-1 py-2 text-body bg-transparent border-b border-transparent focus:border-accent outline-none resize-y"
              />
            </div>

            <div className="bg-bg-primary border border-border-default rounded-lg p-5">
              <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-3">
                첨부
              </div>
              <div className="flex items-center gap-4">
                <AttachBtn icon={LinkIcon} label="링크" onClick={addLink} bg="#dbeafe" color="#1d4ed8" />
                <AttachBtn icon={FileText} label="협업 문서" onClick={addDoc} bg="#fef3c7" color="#a16207" />
                <AttachBtn icon={ClipboardCheck} label="설문" onClick={addSurvey} bg="#fce7f3" color="#be185d" />
              </div>

              {/* 첨부된 항목들 */}
              {attachments.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  {attachments.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-2 border border-border-default rounded hover:bg-bg-secondary group"
                    >
                      <LinkIcon size={13} className="text-text-tertiary" />
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-caption text-accent hover:underline flex-1 truncate">
                          {a.title}
                        </a>
                      ) : (
                        <span className="text-caption flex-1 truncate">{a.title}</span>
                      )}
                      <button
                        onClick={() => removeAttachment(i)}
                        className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 우측 사이드바 */}
          <aside className="space-y-4">
            <Field label="수업">
              <div className="px-3 py-2 border border-border-default rounded text-body bg-bg-primary">
                현재 강좌 (#{cid})
              </div>
            </Field>

            <Field label="할당 대상">
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-border-default rounded-full bg-bg-primary text-body text-text-secondary cursor-default"
                disabled
                title="현재는 강좌 전체 학생 (개별 지정은 향후)"
              >
                <Users size={14} /> 전체 학생 ({studentCount}명)
              </button>
            </Field>

            {kind === "assignment" && (
              <Field label="점수">
                <div className="relative">
                  <Award size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                    placeholder="100"
                    className="w-full pl-9 pr-3 py-2 border border-border-default rounded text-body bg-bg-primary"
                  />
                </div>
              </Field>
            )}

            <Field label="기한">
              <div className="relative">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-border-default rounded text-body bg-bg-primary"
                />
              </div>
              {!dueDate && (
                <div className="text-[11px] text-text-tertiary mt-1">기한 없음</div>
              )}
            </Field>

            <Field label="주제">
              <div className="relative">
                <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  type="text"
                  list="topic-suggest"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="주제 없음"
                  className="w-full pl-9 pr-3 py-2 border border-border-default rounded text-body bg-bg-primary"
                />
                <datalist id="topic-suggest">
                  {existingTopics.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
            </Field>
          </aside>

        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] font-semibold text-text-secondary mb-1.5 px-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function AttachBtn({
  icon: Icon, label, onClick, bg, color,
}: {
  icon: any; label: string; onClick: () => void;
  bg: string; color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 group"
    >
      <div
        className="w-11 h-11 rounded-full border border-border-default flex items-center justify-center group-hover:scale-105 transition"
        style={{ backgroundColor: bg, color }}
      >
        <Icon size={18} />
      </div>
      <span className="text-[11px] text-text-secondary">{label}</span>
    </button>
  );
}
