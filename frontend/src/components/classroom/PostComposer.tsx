"use client";

/**
 * 게시판 새 글 작성 composer — Google Classroom 식 카드 스타일.
 *
 * 두 상태:
 * 1) 닫힘 (collapsed):
 *      [👤] 수업에 새 공지를 입력하세요...
 *    클릭하면 펼침.
 *
 * 2) 열림 (expanded):
 *      [👤 user] [post_type chip group]      [상단 고정 ☐]
 *      ┌────────────────────────────────────┐
 *      │ 제목                                 │
 *      ├────────────────────────────────────┤
 *      │ 본문 (textarea)                      │
 *      └────────────────────────────────────┘
 *      [취소]                         [게시]
 *
 * - 작성 권한 없으면 (canEdit=false) 마운트 안 함 (parent 결정)
 * - api.post 호출은 props.onSubmit으로 위임 (parent가 catch + reload)
 */

import { useState } from "react";
import { Save, X, Pin, Megaphone, Folder, ClipboardList } from "lucide-react";

export type PostType = "notice" | "material" | "assignment_ref";

const TYPE_OPTIONS: { value: PostType; label: string; icon: any; color: string }[] = [
  { value: "notice",         label: "공지",   icon: Megaphone,      color: "text-blue-600" },
  { value: "material",       label: "자료",   icon: Folder,         color: "text-green-600" },
  { value: "assignment_ref", label: "과제",   icon: ClipboardList,  color: "text-purple-600" },
];

interface PostComposerProps {
  /** 표시명 — avatar 옆 작은 텍스트 */
  userName?: string;
  /** 작성자 id (avatar 배경 색 계산용 — 동일 사용자는 항상 같은 색) */
  userId?: number;
  /** 초기 post_type. CreateMenu에서 선택해 진입 시 사용 */
  initType?: PostType;
  /** 펼침 상태로 시작 (CreateMenu에서 진입 시 true 권장) */
  initOpen?: boolean;
  onSubmit: (body: {
    title: string; content: string;
    post_type: PostType; is_pinned: boolean;
  }) => Promise<void>;
}

function avatarColorFromId(id?: number): string {
  if (!id) return "#94a3b8";
  const hue = (id * 137) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

export function PostComposer({
  userName, userId, initType = "notice", initOpen = false, onSubmit,
}: PostComposerProps) {
  const userColor = avatarColorFromId(userId);
  const [open, setOpen] = useState(initOpen);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [postType, setPostType] = useState<PostType>(initType);
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setContent("");
    setPostType("notice");
    setIsPinned(false);
  };

  const close = () => {
    reset();
    setOpen(false);
  };

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      alert("제목·내용 필수");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        content: content.trim(),
        post_type: postType,
        is_pinned: isPinned,
      });
      reset();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const avatarInitial = (userName?.[0] ?? "?").toUpperCase();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full bg-bg-primary border border-border-default rounded-xl px-4 py-3 flex items-center gap-3 hover:shadow-sm transition text-left"
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-body font-medium flex-shrink-0"
          style={{ backgroundColor: userColor }}
        >
          {avatarInitial}
        </div>
        <span className="text-caption text-text-tertiary flex-1">
          수업에 새 공지·자료·과제를 공유하세요...
        </span>
      </button>
    );
  }

  const SelectedIcon = TYPE_OPTIONS.find((t) => t.value === postType)?.icon ?? Megaphone;

  return (
    <div className="bg-bg-primary border border-accent rounded-xl shadow-sm overflow-hidden">
      {/* 헤더: 아바타 + post_type chips + 고정 toggle */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default flex-wrap">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-caption font-medium flex-shrink-0"
          style={{ backgroundColor: userColor }}
        >
          {avatarInitial}
        </div>
        <div className="text-caption text-text-primary font-medium">{userName ?? "작성자"}</div>
        <div className="ml-2 flex items-center gap-1">
          {TYPE_OPTIONS.map((t) => {
            const Icon = t.icon;
            const active = postType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setPostType(t.value)}
                className={`flex items-center gap-1 px-2 py-1 text-[11.5px] rounded-full border transition ${
                  active
                    ? "border-accent bg-accent-light text-accent font-medium"
                    : "border-border-default text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                <Icon size={11} className={active ? "text-accent" : t.color} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-caption text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
            className="cursor-pointer"
          />
          <Pin size={11} /> 상단 고정
        </label>
      </div>

      {/* 본문 입력 */}
      <div className="px-4 py-3 space-y-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
          className="w-full px-1 py-1.5 text-body font-medium bg-transparent border-0 border-b border-transparent focus:border-accent focus:outline-none"
          autoFocus
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="공지·설명을 작성하세요. 학생들이 게시판에서 바로 확인합니다."
          rows={4}
          className="w-full px-1 py-1 text-body bg-transparent border-0 focus:outline-none resize-y"
        />
      </div>

      {/* 액션 */}
      <div className="flex justify-between items-center px-4 py-2.5 bg-bg-secondary border-t border-border-default">
        <div className="text-[11px] text-text-tertiary flex items-center gap-1">
          <SelectedIcon size={11} />
          {TYPE_OPTIONS.find((t) => t.value === postType)?.label}
          {isPinned && (<>{" · "}<Pin size={10} className="inline" /> 고정</>)}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-caption text-text-secondary hover:bg-bg-primary rounded"
          >
            <X size={12} /> 취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !title.trim() || !content.trim()}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            <Save size={12} /> {saving ? "게시 중..." : "게시"}
          </button>
        </div>
      </div>
    </div>
  );
}
