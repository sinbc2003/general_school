"use client";

import { useState, useEffect, useRef } from "react";
import {
  MessageCircle,
  X,
  Send,
  Bug,
  Lightbulb,
  HelpCircle,
  Check,
  Loader2,
} from "lucide-react";
import { createFeedback, getMyFeedback, type FeedbackItem } from "@/lib/api/feedback";
import { usePathname } from "next/navigation";

const TYPES = [
  { key: "bug", label: "오류 신고", icon: Bug, color: "text-red-500", bg: "bg-red-50" },
  { key: "feature", label: "기능 건의", icon: Lightbulb, color: "text-amber-500", bg: "bg-amber-50" },
  { key: "other", label: "기타 문의", icon: HelpCircle, color: "text-blue-500", bg: "bg-cream-100" },
] as const;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: "접수", color: "bg-gray-200 text-gray-700" },
  in_progress: { label: "처리중", color: "bg-cream-200 text-blue-700" },
  resolved: { label: "완료", color: "bg-green-100 text-green-700" },
  dismissed: { label: "반려", color: "bg-red-100 text-red-700" },
};

export function FeedbackPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"write" | "history">("write");
  const [type, setType] = useState<string>("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [history, setHistory] = useState<FeedbackItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (open && tab === "history") {
      setLoadingHistory(true);
      getMyFeedback()
        .then((res) => setHistory(res.items || []))
        .catch(() => {})
        .finally(() => setLoadingHistory(false));
    }
  }, [open, tab]);

  useEffect(() => {
    if (open && tab === "write" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open, tab, type]);

  const handleSubmit = async () => {
    if (!type || !content.trim()) return;
    setSending(true);
    try {
      await createFeedback({ feedback_type: type, content: content.trim(), page_url: pathname || undefined });
      setSent(true);
      setContent("");
      setType("");
      setTimeout(() => setSent(false), 2500);
    } catch {
      alert("전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => { setOpen(!open); setSent(false); }}
        className={`fixed bottom-5 right-5 z-50 flex items-center justify-center w-12 h-12 rounded-full shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 ${
          open ? "bg-bg-secondary text-text-secondary border border-border-default" : "bg-accent text-white"
        }`}
        title="건의/오류 신고"
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-[360px] max-h-[480px] bg-bg-primary border border-border-default rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border-default bg-bg-secondary">
            <div className="text-[14px] font-bold text-text-primary">고객센터</div>
            <div className="text-[12px] text-text-tertiary">오류 신고 및 기능 건의</div>
          </div>

          <div className="flex border-b border-border-default">
            {(["write", "history"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-[13px] font-medium transition-colors ${
                  tab === t ? "text-accent border-b-2 border-accent" : "text-text-tertiary hover:text-text-primary"
                }`}
              >
                {t === "write" ? "작성" : "내 건의 내역"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {tab === "write" ? (
              <div className="p-4 space-y-3">
                {sent ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mb-3">
                      <Check size={20} className="text-green-600" />
                    </div>
                    <p className="text-[14px] font-medium text-text-primary">전송 완료</p>
                    <p className="text-[12px] text-text-tertiary mt-1">확인 후 답변드리겠습니다</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {TYPES.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setType(t.key)}
                          className={`flex flex-col items-center gap-1.5 py-3 rounded-lg border transition-all text-[12px] ${
                            type === t.key
                              ? `${t.bg} border-current ${t.color} font-bold`
                              : "border-border-default text-text-tertiary hover:border-border-hover"
                          }`}
                        >
                          <t.icon size={18} />
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={
                        type === "bug" ? "어떤 오류가 발생했나요? 재현 방법을 알려주세요."
                        : type === "feature" ? "어떤 기능이 있으면 좋겠나요?"
                        : "문의 내용을 입력해주세요."
                      }
                      className="w-full h-28 px-3 py-2 text-[13px] bg-bg-secondary border border-border-default rounded-lg resize-none focus:outline-none focus:border-accent"
                      maxLength={2000}
                    />
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-text-tertiary">{content.length}/2000</span>
                      <button
                        onClick={handleSubmit}
                        disabled={!type || !content.trim() || sending}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                          type && content.trim()
                            ? "bg-accent text-white hover:bg-accent/90"
                            : "bg-bg-tertiary text-text-tertiary cursor-not-allowed"
                        }`}
                      >
                        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        전송
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="p-3">
                {loadingHistory ? (
                  <div className="flex justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-text-tertiary" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center py-8 text-[13px] text-text-tertiary">건의 내역이 없습니다</div>
                ) : (
                  <div className="space-y-2">
                    {history.map((fb) => {
                      const st = STATUS_MAP[fb.status] || STATUS_MAP.pending;
                      const tp = TYPES.find((t) => t.key === fb.feedback_type);
                      return (
                        <div key={fb.id} className="p-3 border border-border-default rounded-lg bg-bg-secondary">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              {tp && <tp.icon size={13} className={tp.color} />}
                              <span className="text-[12px] font-medium text-text-primary">{tp?.label}</span>
                            </div>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                              {st.label}
                            </span>
                          </div>
                          <p className="text-[12px] text-text-secondary line-clamp-3">{fb.content}</p>
                          {fb.admin_note && (
                            <div className="mt-2 p-2 bg-accent/5 rounded text-[12px] text-accent">
                              <span className="font-medium">관리자: </span>{fb.admin_note}
                            </div>
                          )}
                          <div className="text-[11px] text-text-tertiary mt-1.5">
                            {new Date(fb.created_at).toLocaleDateString("ko-KR")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
