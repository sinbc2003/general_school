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

import { useEffect, useRef, useState } from "react";
import {
  X, ClipboardList, Folder, FileText, ClipboardCheck, Link as LinkIcon,
  Trash2, Users, Award, Calendar, Hash, Upload, Loader2, Paperclip, HardDrive, Bot,
  Plus, Presentation, Table2, FileType, ExternalLink, Gamepad2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { DrivePicker } from "./DrivePicker";
import { ChatbotPickerModal } from "./ChatbotPickerModal";
import { QuizPickerModal } from "./QuizPickerModal";

export type CreateKind = "assignment" | "material";

type ShareMode = "view" | "edit" | "copy";

interface AttachmentItem {
  type: "link" | "file" | "doc" | "survey" | "sheet" | "deck" | "hwp" | "chatbot" | "live_quiz";
  title: string;
  url?: string;
  file_url?: string;
  file_name?: string;
  doc_id?: number;
  survey_id?: number;
  sheet_id?: number;
  deck_id?: number;
  hwp_id?: number;
  chatbot_id?: number;
  live_quiz_id?: number;
  /** 학생용 공유 모드. drive 자료(doc/sheet/deck/hwp)만 의미 있음.
   *  link/file/survey/chatbot은 항상 view 강제. copy는 Phase 2 활성화. */
  share_mode?: ShareMode;
}

// 어떤 type에 share_mode 의미 있는가
const DRIVE_TYPES = ["doc", "sheet", "deck", "hwp"] as const;
function isShareable(t: AttachmentItem["type"]): boolean {
  return (DRIVE_TYPES as readonly string[]).includes(t);
}

/** 편집/복제 모드 시 prefill할 기존 post 데이터 */
export interface AssignmentModalInitial {
  postId?: number;       // 있으면 PUT (편집). 없으면 POST (생성/복제).
  title?: string;
  content?: string;
  max_score?: number | null;
  due_date?: string | null;  // ISO
  topic?: string | null;
  attachments?: AttachmentItem[];
}

interface AssignmentModalProps {
  cid: number;
  kind: CreateKind;
  studentCount: number;
  /** 기존 주제 list (자동완성용) */
  existingTopics: string[];
  /** 우측 사이드바 "수업" 표시용 강좌명 (없으면 #cid) */
  courseName?: string;
  /** 편집/복제 모드의 prefill. 없으면 신규 생성. */
  initial?: AssignmentModalInitial;
  /** 모드 표시 — 'edit' | 'duplicate' | undefined(신규) */
  mode?: "edit" | "duplicate";
  /** 만들기 메뉴 진입 — mount 시 해당 자료를 즉석 생성해 자동 첨부
   *  (chatbot은 picker 자동 오픈). 게시하면 수업 과제에 글로 나타난다. */
  autoAttach?: "doc" | "deck" | "sheet" | "survey" | "hwp" | "chatbot";
  onClose: () => void;
  onSaved: (postId: number) => void;
}

/** 첨부 "만들기" — 새 자료를 즉석 생성해 첨부 (Google Classroom 만들기 서브메뉴).
 *  doc/deck/sheet/hwp는 standalone(specific_users)으로 만들어 share_mode가
 *  학생 접근을 결정 (Google과 동일 의미). 설문은 강좌 소속으로 생성. */
const CREATE_ATTACH_DEFS: {
  type: AttachmentItem["type"];
  label: string;
  icon: any;
  bg: string;
  color: string;
  endpoint: string;
  body: (cid: number) => Record<string, any>;
  openHref: (cid: number, id: number) => string;
}[] = [
  {
    type: "doc", label: "문서", icon: FileText, bg: "#dbeafe", color: "#1d4ed8",
    endpoint: "/api/classroom/docs",
    body: () => ({ title: "제목 없는 문서", access_mode: "specific_users" }),
    openHref: (_c, id) => `/docs/${id}`,
  },
  {
    type: "deck", label: "프리젠테이션", icon: Presentation, bg: "#fef3c7", color: "#a16207",
    endpoint: "/api/classroom/decks",
    body: () => ({ title: "제목 없는 프리젠테이션", access_mode: "specific_users" }),
    openHref: (_c, id) => `/docs/decks/${id}`,
  },
  {
    type: "sheet", label: "스프레드시트", icon: Table2, bg: "#dcfce7", color: "#15803d",
    endpoint: "/api/classroom/sheets",
    body: () => ({ title: "제목 없는 스프레드시트", access_mode: "specific_users" }),
    openHref: (_c, id) => `/sheets/${id}`,
  },
  {
    type: "survey", label: "설문지", icon: ClipboardCheck, bg: "#ede9fe", color: "#7c3aed",
    endpoint: "/api/classroom/surveys",
    body: (cid) => ({ title: "제목 없는 설문지", course_id: cid }),
    openHref: (cid, id) => `/classroom/${cid}/surveys/${id}`,
  },
  {
    type: "hwp", label: "한컴 문서", icon: FileType, bg: "#e0f2fe", color: "#0369a1",
    endpoint: "/api/classroom/hwps",
    body: () => ({ title: "제목 없는 HWP", access_mode: "specific_users" }),
    openHref: (_c, id) => `/hwps/${id}`,
  },
];

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
  cid, kind, studentCount, existingTopics, courseName, initial, mode, autoAttach, onClose, onSaved,
}: AssignmentModalProps) {
  const meta = KIND_META[kind];

  // datetime-local input은 "YYYY-MM-DDTHH:MM" 형식. ISO → local 변환.
  const isoToLocal = (iso?: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  };

  const [title, setTitle] = useState(initial?.title || "");
  const [content, setContent] = useState(initial?.content || "");
  const [maxScore, setMaxScore] = useState<string>(
    initial?.max_score != null ? String(initial.max_score)
    : kind === "assignment" ? "100" : "",
  );
  const [dueDate, setDueDate] = useState(isoToLocal(initial?.due_date)); // YYYY-MM-DDTHH:MM
  const [topic, setTopic] = useState(initial?.topic || "");
  const [attachments, setAttachments] = useState<AttachmentItem[]>(initial?.attachments || []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isEdit = mode === "edit" && initial?.postId;
  const headerLabel = isEdit ? `${meta.title} 편집`
    : mode === "duplicate" ? `${meta.title} 복제`
    : meta.title;
  const submitLabel = isEdit ? "저장" : meta.submitLabel;

  const titleEmpty = !title.trim();

  const addLink = () => {
    const url = window.prompt("링크 URL:");
    if (!url) return;
    const t = window.prompt("표시할 제목:", url) || url;
    setAttachments([...attachments, { type: "link", url, title: t }]);
  };

  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [showChatbotPicker, setShowChatbotPicker] = useState(false);
  const [showQuizPicker, setShowQuizPicker] = useState(false);

  // 첨부 "만들기" 서브메뉴 (Google Classroom 식)
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [creatingType, setCreatingType] = useState<string | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [createMenuOpen]);

  const createAndAttach = async (
    def: (typeof CREATE_ATTACH_DEFS)[number],
    opts: { openEditor: boolean } = { openEditor: true },
  ) => {
    if (creatingType) return;
    setCreateMenuOpen(false);
    setCreatingType(def.type);
    // popup blocker 회피 — 사용자 제스처 동기 시점에 창을 먼저 열고 URL은 나중에.
    // (만들기 메뉴 진입의 자동 첨부는 제스처 체인이 끊겨 차단되므로 openEditor=false —
    //  첨부 행 제목 링크로 편집기를 연다.)
    const win = opts.openEditor ? window.open("", "_blank") : null;
    try {
      const res = await api.post<{ id: number; title?: string }>(def.endpoint, def.body(cid));
      const idKey = `${def.type}_id`;
      const item: any = { type: def.type, title: res.title || def.body(cid).title, [idKey]: res.id };
      if (isShareable(def.type)) item.share_mode = "view";
      setAttachments((prev) => [...prev, item]);
      const href = def.openHref(cid, res.id);
      if (win) win.location.href = href;
    } catch (e: any) {
      win?.close();
      alert(e?.detail || `${def.label} 생성 실패`);
    } finally {
      setCreatingType(null);
    }
  };

  // 만들기 메뉴 진입 (autoAttach) — mount 시 1회 자동 생성·첨부.
  // ref 가드: React StrictMode dev 이중 effect로 자료가 2개 생기는 것 방지.
  const didAutoAttachRef = useRef(false);
  useEffect(() => {
    if (!autoAttach || didAutoAttachRef.current) return;
    didAutoAttachRef.current = true;
    if (autoAttach === "chatbot") {
      setShowChatbotPicker(true);
      return;
    }
    const def = CREATE_ATTACH_DEFS.find((d) => d.type === autoAttach);
    if (def) createAndAttach(def, { openEditor: false });
  }, [autoAttach]);  // eslint-disable-line react-hooks/exhaustive-deps

  /** 첨부 행 제목 → 편집기 링크 (드라이브 자료만) */
  const editorHref = (a: AttachmentItem): string | null => {
    const id = a.doc_id ?? a.deck_id ?? a.sheet_id ?? a.survey_id ?? a.hwp_id;
    if (!id) return null;
    const def = CREATE_ATTACH_DEFS.find((d) => d.type === a.type);
    return def ? def.openHref(cid, id) : null;
  };

  // 새 탭에서 자료 이름을 바꾸고 돌아오면(focus) 첨부 제목 동기화.
  // 게시된 글은 백엔드가 읽기 시점에 enrichment하므로 여기선 작성 중 화면만 처리.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => {
    const TYPE_ENDPOINT: Record<string, string> = {
      doc: "/api/classroom/docs",
      deck: "/api/classroom/decks",
      sheet: "/api/classroom/sheets",
      survey: "/api/classroom/surveys",
      hwp: "/api/classroom/hwps",
    };
    const refresh = async () => {
      const targets = attachmentsRef.current.filter((a) => {
        const base = TYPE_ENDPOINT[a.type];
        return base && (a as any)[`${a.type}_id`];
      });
      if (targets.length === 0) return;
      const fresh: Record<string, string> = {};
      await Promise.all(targets.map(async (a) => {
        const id = (a as any)[`${a.type}_id`];
        try {
          const res = await api.get<{ title?: string }>(`${TYPE_ENDPOINT[a.type]}/${id}`);
          if (res?.title) fresh[`${a.type}:${id}`] = res.title;
        } catch { /* 삭제·권한 변경 등 — 제목 유지 */ }
      }));
      if (Object.keys(fresh).length === 0) return;
      setAttachments((prev) => prev.map((a) => {
        const id = (a as any)[`${a.type}_id`];
        const t = id ? fresh[`${a.type}:${id}`] : undefined;
        return t && t !== a.title ? { ...a, title: t } : a;
      }));
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const addChatbot = (bot: { chatbot_id: number; title: string }) => {
    setAttachments([...attachments, { type: "chatbot", title: bot.title, chatbot_id: bot.chatbot_id }]);
  };

  const addQuiz = (q: { live_quiz_id: number; title: string }) => {
    setAttachments([...attachments, { type: "live_quiz", title: q.title, live_quiz_id: q.live_quiz_id }]);
  };

  const addFromDrive = (picked: Array<{ type: string; source_id: number; title: string }>) => {
    const next: AttachmentItem[] = picked.map((p) => {
      // backend attachments format: doc → {type:"doc", doc_id, title}, survey → {type:"survey", survey_id, title}
      // sheet/deck/hwp도 같은 패턴.
      const idKey = `${p.type}_id`;
      const item: any = { type: p.type as any, title: p.title, [idKey]: p.source_id };
      if (isShareable(p.type as AttachmentItem["type"])) {
        item.share_mode = "view"; // default. 첨부 행 옆에서 토글로 변경.
      }
      return item;
    });
    setAttachments([...attachments, ...next]);
  };

  const setShareMode = (idx: number, mode: ShareMode) => {
    setAttachments(attachments.map((a, i) => (i === idx ? { ...a, share_mode: mode } : a)));
  };

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const next: AttachmentItem[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const res = await api.upload<{ file_url: string; file_name: string; byte_size: number }>(
          `/api/classroom/courses/${cid}/attachments`,
          f,
        );
        next.push({
          type: "file",
          title: res.file_name,
          file_url: res.file_url,
          file_name: res.file_name,
        });
      }
      setAttachments([...attachments, ...next]);
    } catch (err: any) {
      alert(err?.detail || "업로드 실패");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
      };
      if (!isEdit) body.is_pinned = false;
      if (maxScore && kind === "assignment") {
        body.max_score = Math.max(0, Math.min(10000, parseInt(maxScore, 10) || 0));
      }
      if (dueDate) body.due_date = new Date(dueDate).toISOString();
      // 편집 시: 사용자가 비웠으면 명시적 null로 (백엔드가 update 안 함; 본 모달은 단순화로 항상 보냄)
      if (topic.trim()) body.topic = topic.trim();
      if (attachments.length > 0) body.attachments = attachments;

      let postId: number;
      if (isEdit && initial?.postId) {
        await api.put(`/api/classroom/posts/${initial.postId}`, body);
        postId = initial.postId;
      } else {
        const res = await api.post<{ id: number }>(`/api/classroom/courses/${cid}/posts`, body);
        postId = res.id;
      }
      onSaved(postId);
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
          <h1 className="text-body font-medium">{headerLabel}</h1>
        </div>
        <button
          onClick={submit}
          disabled={titleEmpty || saving}
          className="px-5 py-2 text-caption font-medium bg-accent text-white rounded-full hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {saving ? "저장 중..." : submitLabel}
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
              <div className="flex items-center gap-4 flex-wrap">
                <AttachBtn icon={HardDrive} label="내 드라이브" onClick={() => setShowDrivePicker(true)} bg="#ede9fe" color="#7c3aed" />
                {/* 만들기 — Google Classroom 식: 새 자료 즉석 생성 + 첨부 */}
                <div ref={createMenuRef} className="relative">
                  <AttachBtn
                    icon={creatingType ? Loader2 : Plus}
                    label={creatingType ? "생성 중..." : "만들기"}
                    onClick={() => setCreateMenuOpen((v) => !v)}
                    bg="#fce7f3"
                    color="#be185d"
                    spin={!!creatingType}
                  />
                  {createMenuOpen && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-30 bg-bg-primary border border-border-default rounded-lg shadow-lg w-[200px] py-1.5">
                      {CREATE_ATTACH_DEFS.map((d) => {
                        const DIcon = d.icon;
                        return (
                          <button
                            key={d.type}
                            type="button"
                            onClick={() => createAndAttach(d)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg-secondary text-left"
                          >
                            <span
                              className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: d.bg, color: d.color }}
                            >
                              <DIcon size={14} />
                            </span>
                            <span className="text-body text-text-primary">{d.label}</span>
                          </button>
                        );
                      })}
                      <div className="px-3 pt-1.5 mt-1 border-t border-border-default text-[10.5px] text-text-tertiary">
                        생성 후 새 탭에서 편집 · 자동 첨부
                      </div>
                    </div>
                  )}
                </div>
                <AttachBtn
                  icon={uploading ? Loader2 : Upload}
                  label={uploading ? "업로드 중..." : "업로드"}
                  onClick={triggerFilePicker}
                  bg="#e0e7ff"
                  color="#4338ca"
                  spin={uploading}
                />
                <AttachBtn icon={LinkIcon} label="링크" onClick={addLink} bg="#dbeafe" color="#1d4ed8" />
                <AttachBtn icon={Bot} label="챗봇" onClick={() => setShowChatbotPicker(true)} bg="#e0f2fe" color="#0369a1" />
                <AttachBtn icon={Gamepad2} label="퀴즈" onClick={() => setShowQuizPicker(true)} bg="#f3e8ff" color="#7e22ce" />
              </div>
              {showDrivePicker && (
                <DrivePicker
                  onClose={() => setShowDrivePicker(false)}
                  onSelect={addFromDrive}
                />
              )}
              {showChatbotPicker && (
                <ChatbotPickerModal
                  cid={cid}
                  onClose={() => setShowChatbotPicker(false)}
                  onSelect={addChatbot}
                />
              )}
              {showQuizPicker && (
                <QuizPickerModal
                  onClose={() => setShowQuizPicker(false)}
                  onSelect={addQuiz}
                />
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.zip"
              />

              {/* 첨부된 항목들 */}
              {attachments.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  {attachments.map((a, i) => {
                    const emoji: Record<string, string> = {
                      doc: "📄", sheet: "📊", deck: "🖼️", survey: "📋", hwp: "📝",
                    };
                    const Icon = a.type === "file" ? Paperclip
                      : a.type === "chatbot" ? Bot
                      : a.type === "live_quiz" ? Gamepad2
                      : LinkIcon;
                    const shareable = isShareable(a.type);
                    // 드라이브 자료 — 행 어디를 눌러도 새 창에서 편집기 오픈
                    const openHref = a.url ? null : editorHref(a);
                    return (
                      <div
                        key={i}
                        onClick={openHref ? () => window.open(openHref, "_blank", "noopener") : undefined}
                        className={`flex items-center gap-2 px-3 py-2 border border-border-default rounded hover:bg-bg-secondary group ${
                          openHref ? "cursor-pointer" : ""
                        }`}
                        title={openHref ? "클릭하면 새 창에서 열립니다" : undefined}
                      >
                        {emoji[a.type] ? (
                          <span className="text-[14px] flex-shrink-0">{emoji[a.type]}</span>
                        ) : (
                          <Icon size={13} className="text-text-tertiary flex-shrink-0" />
                        )}
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-caption text-accent hover:underline flex-1 truncate">
                            {a.title}
                          </a>
                        ) : openHref ? (
                          <a
                            href={openHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-caption text-accent hover:underline flex-1 truncate"
                            title="새 창에서 편집"
                          >
                            {a.title}
                          </a>
                        ) : a.file_name ? (
                          <span className="text-caption flex-1 truncate" title={a.file_name}>
                            {a.title}
                          </span>
                        ) : (
                          <span className="text-caption flex-1 truncate">{a.title}</span>
                        )}
                        {openHref && (
                          <ExternalLink size={12} className="text-text-tertiary flex-shrink-0" />
                        )}
                        {shareable && (
                          <select
                            value={a.share_mode || "view"}
                            onChange={(e) => setShareMode(i, e.target.value as ShareMode)}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] border border-border-default rounded px-1.5 py-0.5 bg-bg-primary"
                            title="파일 공유 옵션"
                          >
                            <option value="view">학생에게 보기 권한 제공</option>
                            <option value="edit">학생에게 수정 권한 제공</option>
                            <option value="copy">학생별로 사본 제공</option>
                          </select>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); removeAttachment(i); }}
                          className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-error"
                          title="제거"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 우측 사이드바 */}
          <aside className="space-y-4">
            <Field label="수업">
              <div className="px-3 py-2 border border-border-default rounded text-body bg-bg-primary truncate">
                {courseName || `현재 강좌 (#${cid})`}
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
  icon: Icon, label, onClick, bg, color, spin,
}: {
  icon: any; label: string; onClick: () => void;
  bg: string; color: string;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={spin}
      className="flex flex-col items-center gap-1 group disabled:opacity-60 disabled:cursor-progress"
    >
      <div
        className="w-11 h-11 rounded-full border border-border-default flex items-center justify-center group-hover:scale-105 transition"
        style={{ backgroundColor: bg, color }}
      >
        <Icon size={18} className={spin ? "animate-spin" : ""} />
      </div>
      <span className="text-[11px] text-text-secondary">{label}</span>
    </button>
  );
}
