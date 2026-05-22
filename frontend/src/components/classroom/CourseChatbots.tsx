"use client";

/**
 * 강좌 챗봇 탭 — 강좌마다 시스템 프롬프트 + 모델 지정 챗봇 관리.
 *
 * 교사: 만들기 / 편집 / 삭제 / 사용
 * 학생: list + 사용만 (start-session → /s/chat/{sid})
 *
 * backend:
 *   GET    /api/classroom/courses/{cid}/chatbots
 *   POST   /api/classroom/courses/{cid}/chatbots
 *   PUT    /api/classroom/chatbots/{bid}
 *   DELETE /api/classroom/chatbots/{bid}
 *   POST   /api/classroom/chatbots/{bid}/start-session → { session_id }
 */

import { useCallback, useEffect, useState } from "react";
import { Bot, Plus, Edit2, Trash2, MessageSquare, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

interface Chatbot {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  system_prompt: string;
  provider: string | null;
  model_id: string | null;
  is_active: boolean;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export function CourseChatbots({ cid, canEdit }: { cid: number; canEdit: boolean }) {
  const { user } = useAuth();
  const isStudent = user?.role === "student";
  const [items, setItems] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Chatbot | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: Chatbot[] }>(`/api/classroom/courses/${cid}/chatbots`);
      setItems(r.items);
    } catch (e: any) {
      console.warn("챗봇 list 실패", e);
    } finally {
      setLoading(false);
    }
  }, [cid]);

  useEffect(() => { load(); }, [load]);

  const startChat = async (bid: number) => {
    try {
      const r = await api.post<{ session_id: number }>(
        `/api/classroom/chatbots/${bid}/start-session`, {},
      );
      window.location.href = isStudent ? `/s/chat?session=${r.session_id}` : `/chat?session=${r.session_id}`;
    } catch (e: any) {
      alert(e?.detail || e?.message || "챗봇을 시작할 수 없습니다");
    }
  };

  const remove = async (b: Chatbot) => {
    if (!confirm(`"${b.name}" 챗봇을 삭제할까요? (학생들의 기존 대화는 보존됩니다)`)) return;
    try {
      await api.delete(`/api/classroom/chatbots/${b.id}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  if (loading) return <div className="text-text-tertiary py-6 text-center">불러오는 중...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-violet-700" />
            <h2 className="text-title text-text-primary">강좌 챗봇</h2>
            <span className="text-[11px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded">
              {items.length}
            </span>
          </div>
          <p className="text-caption text-text-tertiary mt-1">
            강좌 수강생만 사용 가능. 시스템 프롬프트는 학생용 가드레일과 자동 결합됩니다.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-3 py-2 text-[12px] bg-violet-600 text-white rounded hover:bg-violet-700 flex items-center gap-1"
          >
            <Plus size={13} /> 챗봇 추가
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <Bot size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">아직 챗봇이 없습니다</div>
          {canEdit && (
            <div className="text-caption text-text-tertiary mt-1">
              교사가 강좌 챗봇을 만들면 학생들이 강좌별 프롬프트로 챗을 사용할 수 있습니다.
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((b) => (
            <div
              key={b.id}
              className={`bg-bg-primary border rounded-lg p-4 transition ${
                b.is_active ? "border-border-default" : "border-amber-300 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0">
                    <Bot size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-body font-semibold text-text-primary truncate">
                      {b.name}
                    </div>
                    {!b.is_active && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
                        비활성
                      </span>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditing(b)}
                      className="p-1.5 text-text-tertiary hover:text-accent rounded"
                      title="편집"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(b)}
                      className="p-1.5 text-text-tertiary hover:text-status-error rounded"
                      title="삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              {b.description && (
                <p className="text-caption text-text-secondary mb-2 line-clamp-2">{b.description}</p>
              )}
              <p className="text-[11px] text-text-tertiary line-clamp-2 bg-bg-secondary rounded px-2 py-1.5 mb-3">
                {b.system_prompt}
              </p>
              <button
                type="button"
                onClick={() => startChat(b.id)}
                disabled={!b.is_active}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded text-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <MessageSquare size={13} /> 챗봇 시작
              </button>
            </div>
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <ChatbotEditModal
          cid={cid}
          initial={editing}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowCreate(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}


function ChatbotEditModal({
  cid,
  initial,
  onClose,
  onSaved,
}: {
  cid: number;
  initial: Chatbot | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [systemPrompt, setSystemPrompt] = useState(
    initial?.system_prompt ||
    "이 챗봇은 학생들의 학습을 돕는 보조 도우미입니다. 명확하고 친절하게 설명해주세요.",
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !systemPrompt.trim()) {
      alert("이름과 시스템 프롬프트는 필수입니다");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        system_prompt: systemPrompt.trim(),
        is_active: isActive,
      };
      if (initial) {
        await api.put(`/api/classroom/chatbots/${initial.id}`, body);
      } else {
        await api.post(`/api/classroom/courses/${cid}/chatbots`, body);
      }
      onSaved();
    } catch (e: any) {
      alert(e?.detail || e?.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-semibold text-text-primary">
            {initial ? "챗봇 편집" : "챗봇 추가"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-text-tertiary hover:bg-bg-secondary rounded"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          <div>
            <label className="text-caption font-medium text-text-secondary mb-1 block">
              이름 *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 수학 보조 챗봇"
              maxLength={200}
              className="w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary"
            />
          </div>

          <div>
            <label className="text-caption font-medium text-text-secondary mb-1 block">
              설명 (선택)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="학생에게 보여줄 짧은 설명"
              className="w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary"
            />
          </div>

          <div>
            <label className="text-caption font-medium text-text-secondary mb-1 block">
              시스템 프롬프트 *
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              maxLength={20000}
              placeholder="이 챗봇이 어떻게 행동해야 하는지 자세히 작성하세요. 예: 학생이 수학 문제를 물어보면 단계별로 설명하고, 정답을 바로 알려주지 말고 힌트로 유도하세요."
              className="w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary font-mono text-[12px]"
            />
            <p className="text-[11px] text-text-tertiary mt-1">
              학생 챗에는 시스템의 기본 가드레일 프롬프트가 자동으로 앞에 결합됩니다.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded"
            />
            <span className="text-caption text-text-secondary">활성화 (학생들이 사용 가능)</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-[12px] border border-border-default rounded hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim() || !systemPrompt.trim()}
            className="px-3 py-2 text-[12px] bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : initial ? "저장" : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}
