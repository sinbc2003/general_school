"use client";

/**
 * Claude.ai 풍 챗봇 인터페이스 (독립 풀스크린 레이아웃)
 *
 * 디자인 원칙:
 * - 배경: warm beige (#faf9f5)
 * - 액센트: claude orange (#c15f3c)
 * - 사이드바: 좁고 옅은 배경, 호버 시 강조
 * - 시작 화면: 가운데 큰 인사 + 큰 입력창
 * - 메시지: 사용자(우측 베이지 박스), 어시스턴트(좌측 박스 없이 텍스트)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Plus, ChevronDown, Sparkles, X,
  AlertCircle, MoreHorizontal, PanelLeftClose, PanelLeft,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

import { api } from "@/lib/api/client";
import { C, type Session, type Message, type ModelInfo } from "./_chat-styles";
import { SessionGroup } from "./SessionGroup";
import { MessageBubble } from "./MessageBubble";
import { ChatInputBox } from "./ChatInputBox";

interface ChatInterfaceProps {
  audience: "teacher" | "student";
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export default function ChatInterface({ audience }: ChatInterfaceProps) {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editTitleId, setEditTitleId] = useState<number | null>(null);
  const [editTitleVal, setEditTitleVal] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hoveredSession, setHoveredSession] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const canChangeModel =
    audience === "teacher"
      ? config.teacher_can_change_model !== "false"
      : config.student_can_change_model === "true";

  useEffect(() => { loadSessions(); loadModelsAndConfig(); }, []);
  useEffect(() => { if (activeId) loadMessages(activeId); else setMessages([]); }, [activeId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamText]);

  // textarea auto resize
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  const loadSessions = async () => {
    try {
      const data = await api.get("/api/chatbot/sessions");
      setSessions(data.items);
    } catch (e: any) { setError(e?.detail || "세션 로드 실패"); }
  };

  const loadModelsAndConfig = async () => {
    try {
      const [m, c] = await Promise.all([api.get("/api/chatbot/models"), api.get("/api/chatbot/config")]);
      setModels(m.items);
      setConfig(c);
    } catch {}
  };

  const loadMessages = async (sid: number) => {
    try {
      const data = await api.get(`/api/chatbot/sessions/${sid}`);
      setMessages(data.messages);
    } catch (e: any) { setError(e?.detail || "메시지 로드 실패"); }
  };

  const newSession = async () => {
    setActiveId(null);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  };

  // 첫 메시지 전송 시 세션이 없으면 생성
  const ensureSession = async (): Promise<number | null> => {
    if (activeId) return activeId;
    try {
      const data = await api.post("/api/chatbot/sessions", {});
      await loadSessions();
      setActiveId(data.id);
      return data.id;
    } catch (e: any) {
      setError(e?.detail || "관리자가 LLM provider를 설정해야 합니다.");
      return null;
    }
  };

  const deleteSession = async (sid: number) => {
    if (!confirm("이 대화를 삭제하시겠습니까? (복구 불가)")) return;
    await api.delete(`/api/chatbot/sessions/${sid}`);
    if (activeId === sid) { setActiveId(null); setMessages([]); }
    await loadSessions();
  };

  const renameSession = async (sid: number) => {
    if (!editTitleVal.trim()) return;
    await api.patch(`/api/chatbot/sessions/${sid}`, { title: editTitleVal.trim() });
    setEditTitleId(null);
    await loadSessions();
  };

  const changeModel = async (provider: string, modelId: string) => {
    if (!activeId) {
      setConfig({ ...config, _pending_provider: provider, _pending_model: modelId });
      setShowModelPicker(false);
      return;
    }
    await api.patch(`/api/chatbot/sessions/${activeId}`, { provider, model_id: modelId });
    await loadSessions();
    setShowModelPicker(false);
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || streaming) return;

    let sid = activeId;
    if (!sid) {
      sid = await ensureSession();
      if (!sid) return;
    }

    setInput("");
    setError(null);
    setStreaming(true);
    setStreamText("");

    const optimistic: Message = {
      id: Date.now(), role: "user", content,
      input_tokens: 0, output_tokens: 0, cost_usd: 0,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";
      const res = await fetch(`${API_URL}/api/chatbot/sessions/${sid}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "요청 실패");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === "delta" && evt.text) {
              acc += evt.text;
              setStreamText(acc);
            } else if (evt.type === "error" || evt.error) {
              setError(evt.message || evt.error);
            } else if (evt.type === "done") {
              await loadMessages(sid);
              await loadSessions();
              setStreamText("");
            }
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message || "스트림 오류");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stopStream = () => abortRef.current?.abort();

  const activeSession = sessions.find((s) => s.id === activeId);
  const activeModel = models.find(
    (m) =>
      (activeSession ? m.provider === activeSession.provider : m.provider === (config._pending_provider || (audience === "teacher" ? config.default_provider_teacher : config.default_provider_student))) &&
      (activeSession ? m.model_id === activeSession.model_id : m.model_id === (config._pending_model || (audience === "teacher" ? config.default_model_teacher : config.default_model_student)))
  );
  const availableModels = models.filter((m) => m.active);

  // 세션 그룹핑: pinned, today, yesterday, last 7 days, older
  const groupSessions = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const sevenDaysAgo = today - 7 * 86400000;

    const pinned: Session[] = [];
    const todayList: Session[] = [];
    const yestList: Session[] = [];
    const weekList: Session[] = [];
    const olderList: Session[] = [];

    for (const s of sessions) {
      const t = s.last_message_at ? new Date(s.last_message_at).getTime() : new Date(s.created_at).getTime();
      if (s.pinned) pinned.push(s);
      else if (t >= today) todayList.push(s);
      else if (t >= yesterday) yestList.push(s);
      else if (t >= sevenDaysAgo) weekList.push(s);
      else olderList.push(s);
    }
    return { pinned, today: todayList, yesterday: yestList, week: weekList, older: olderList };
  };

  const groups = groupSessions();
  const isEmpty = !activeId && messages.length === 0 && streamText === "";

  return (
    <div className={`h-screen flex ${C.bg} ${C.text} font-sans`} style={{ fontFamily: '"Söhne", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className={`w-64 flex-shrink-0 ${C.bgSidebar} flex flex-col shadow-[1px_0_0_rgba(0,0,0,0.04),3px_0_10px_-3px_rgba(0,0,0,0.05)]`}>
          {/* Top */}
          <div className="px-3 pt-3 pb-2 flex items-center justify-between">
            <div className={`flex items-center gap-1.5 ${C.text}`}>
              <Sparkles size={16} className={C.accentText} />
              <span className="text-[14px] font-semibold">학교 AI</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className={`p-1 rounded ${C.bgItem} ${C.textMuted}`}
              title="사이드바 닫기"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>

          <button
            onClick={newSession}
            className={`mx-3 mt-1 mb-3 flex items-center justify-between px-3 py-2 ${C.bgItem} rounded-lg text-[13px] font-medium`}
          >
            <div className="flex items-center gap-2">
              <Plus size={14} />
              <span>새 대화</span>
            </div>
          </button>

          {/* Sessions list */}
          <nav className="flex-1 overflow-y-auto px-2 pb-3">
            {sessions.length === 0 && (
              <div className={`px-3 py-8 text-center text-[12px] ${C.textSubtle}`}>
                아직 대화가 없습니다.
              </div>
            )}

            <SessionGroup label="고정됨" sessions={groups.pinned} {...{ activeId, setActiveId, hoveredSession, setHoveredSession, editTitleId, setEditTitleId, editTitleVal, setEditTitleVal, renameSession, deleteSession, C }} />
            <SessionGroup label="오늘" sessions={groups.today} {...{ activeId, setActiveId, hoveredSession, setHoveredSession, editTitleId, setEditTitleId, editTitleVal, setEditTitleVal, renameSession, deleteSession, C }} />
            <SessionGroup label="어제" sessions={groups.yesterday} {...{ activeId, setActiveId, hoveredSession, setHoveredSession, editTitleId, setEditTitleId, editTitleVal, setEditTitleVal, renameSession, deleteSession, C }} />
            <SessionGroup label="지난 7일" sessions={groups.week} {...{ activeId, setActiveId, hoveredSession, setHoveredSession, editTitleId, setEditTitleId, editTitleVal, setEditTitleVal, renameSession, deleteSession, C }} />
            <SessionGroup label="이전" sessions={groups.older} {...{ activeId, setActiveId, hoveredSession, setHoveredSession, editTitleId, setEditTitleId, editTitleVal, setEditTitleVal, renameSession, deleteSession, C }} />
          </nav>

          {/* User */}
          <div className={`border-t ${C.border} p-3 flex items-center gap-2`}>
            <div className={`w-8 h-8 rounded-full ${C.accent} text-white flex items-center justify-center text-[13px] font-semibold flex-shrink-0`}>
              {user?.name?.[0] || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[13px] ${C.text} truncate`}>{user?.name}</div>
              <div className={`text-[11px] ${C.textSubtle} truncate`}>
                {audience === "teacher" ? "교사" : "학생"}
              </div>
            </div>
            <button onClick={logout} className={`p-1.5 ${C.bgItem} rounded ${C.textMuted}`} title="로그아웃">
              <LogOut size={14} />
            </button>
          </div>
        </aside>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className={`h-12 flex items-center justify-between px-4 border-b ${C.border}`}>
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className={`p-1.5 ${C.bgItem} rounded ${C.textMuted}`}
                title="사이드바 열기"
              >
                <PanelLeft size={16} />
              </button>
            )}
            <div className="relative">
              {canChangeModel ? (
                <button
                  onClick={() => setShowModelPicker(!showModelPicker)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[13px] ${C.bgItem} rounded ${C.text}`}
                >
                  <span>{activeModel?.display_name || "모델 선택"}</span>
                  <ChevronDown size={14} className={C.textSubtle} />
                </button>
              ) : (
                <span className={`text-[13px] ${C.textMuted}`}>
                  {activeModel?.display_name || "기본 모델"}
                </span>
              )}
              {showModelPicker && (
                <div className={`absolute top-full left-0 mt-1 w-72 ${C.bgInput} border ${C.border} rounded-lg shadow-lg z-20 max-h-80 overflow-y-auto`}>
                  {availableModels.length === 0 && (
                    <div className={`p-3 text-[12px] ${C.textSubtle}`}>
                      활성화된 모델이 없습니다. 관리자가 API 키를 등록해야 합니다.
                    </div>
                  )}
                  {availableModels.map((m) => (
                    <button
                      key={`${m.provider}/${m.model_id}`}
                      onClick={() => changeModel(m.provider, m.model_id)}
                      className={`w-full text-left px-3 py-2 ${C.bgItem} border-b ${C.border} last:border-0`}
                    >
                      <div className={`text-[13px] ${C.text}`}>{m.display_name}</div>
                      <div className={`text-[11px] ${C.textSubtle}`}>
                        {m.provider} · ${m.input_per_1m_usd}/${m.output_per_1m_usd} per 1M
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={`text-[11px] ${C.textSubtle}`}>
            {activeSession ? `$${activeSession.total_cost_usd.toFixed(5)}` : ""}
          </div>
        </header>

        {/* Body */}
        {isEmpty ? (
          /* 시작 화면 */
          <div className="flex-1 flex items-center justify-center px-4">
            <div className="w-full max-w-2xl">
              <div className="text-center mb-8">
                <div className={`inline-flex w-12 h-12 ${C.accent} text-white rounded-full items-center justify-center mb-4`}>
                  <Sparkles size={24} />
                </div>
                <h1 className={`text-[28px] font-semibold ${C.text} mb-2`}>
                  {audience === "teacher" ? `안녕하세요, ${user?.name || ""} 선생님` : `안녕하세요, ${user?.name || ""}`}
                </h1>
                <p className={`text-[15px] ${C.textMuted}`}>
                  {audience === "teacher"
                    ? "오늘은 무엇을 도와드릴까요?"
                    : "오늘은 무엇을 함께 공부할까요?"}
                </p>
              </div>

              <ChatInputBox
                input={input} setInput={setInput} sendMessage={sendMessage}
                streaming={streaming} stopStream={stopStream} inputRef={inputRef}
                placeholder={audience === "student" ? "학습 도움이 필요한 내용을 적어보세요" : "메시지를 입력하세요"}
                C={C}
              />

              {audience === "student" && (
                <div className={`mt-6 grid grid-cols-1 md:grid-cols-2 gap-2`}>
                  {[
                    "이 수학 문제 풀이 단계 알려줘",
                    "오늘 배운 개념 요약 도와줘",
                    "독서 후 감상문 쓰는 법",
                    "진로 고민 상담",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className={`text-left px-4 py-3 ${C.bgInput} border ${C.border} rounded-lg text-[13px] ${C.textMuted} hover:${C.text}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {audience === "teacher" && (
                <div className={`mt-6 grid grid-cols-1 md:grid-cols-2 gap-2`}>
                  {[
                    "이번 단원 평가 문항 5개 출제해줘",
                    "학생 상담 노트 정리 도와줘",
                    "협의록 초안 작성",
                    "수업 자료 아이디어 제안",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className={`text-left px-4 py-3 ${C.bgInput} border ${C.border} rounded-lg text-[13px] ${C.textMuted} hover:${C.text}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <div className="mt-4 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700 flex items-center gap-2">
                  <AlertCircle size={14} /> {error}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 메시지 영역 */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} C={C} />
                ))}
                {streaming && streamText && (
                  <MessageBubble
                    streaming
                    C={C}
                    message={{
                      id: -1, role: "assistant", content: streamText,
                      input_tokens: 0, output_tokens: 0, cost_usd: 0,
                      created_at: new Date().toISOString(),
                    }}
                  />
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* 에러 */}
            {error && (
              <div className="max-w-3xl mx-auto w-full px-4 mb-2">
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700 flex items-center gap-2">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  <span className="flex-1">{error}</span>
                  <button onClick={() => setError(null)}><X size={12} /></button>
                </div>
              </div>
            )}

            {/* 입력 (대화 중) */}
            <div className="px-4 pb-6">
              <div className="max-w-3xl mx-auto">
                <ChatInputBox
                  input={input} setInput={setInput} sendMessage={sendMessage}
                  streaming={streaming} stopStream={stopStream} inputRef={inputRef}
                  placeholder="이어서 답하기..."
                  C={C}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

