"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "@/lib/api/client";

const FIELDS: { key: string; label: string; type: "select" | "bool" | "number" | "text"; help?: string }[] = [
  { key: "default_provider_teacher", label: "교사 기본 Provider", type: "select", help: "교사 챗봇 새 세션의 기본 provider" },
  { key: "default_model_teacher", label: "교사 기본 모델", type: "text", help: "예: claude-sonnet-4-6, gpt-4o" },
  { key: "default_provider_student", label: "학생 기본 Provider", type: "select", help: "학생 챗봇 새 세션의 기본 provider" },
  { key: "default_model_student", label: "학생 기본 모델", type: "text", help: "비용 통제 위해 저렴한 모델 권장 (haiku, gpt-4o-mini, gemini flash)" },
  { key: "teacher_can_change_model", label: "교사가 모델 변경 가능", type: "bool" },
  { key: "student_can_change_model", label: "학생이 모델 변경 가능", type: "bool", help: "기본 false — 비용 통제" },
  { key: "student_can_pick_prompt", label: "학생이 시스템 프롬프트 선택 가능", type: "bool", help: "기본 false — 가드레일 강제" },
  { key: "max_message_length", label: "메시지 최대 길이 (문자수)", type: "number" },
  { key: "max_session_messages", label: "세션당 최대 메시지 수", type: "number" },
];

export default function LLMConfigPage() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [toolAiStudent, setToolAiStudent] = useState(false);
  const [toolAiSaving, setToolAiSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/api/chatbot/config"),
      api.get("/api/chatbot/models/all"),
      api.get("/api/tool-ai/admin/config"),
    ]).then(([c, m, t]) => {
      setCfg(c);
      setModels(m.items.filter((x: any) => x.is_active));
      setProviders(["openai", "anthropic", "google"]);
      setToolAiStudent(!!t.student_allowed);
    });
  }, []);

  const toggleToolAiStudent = async (v: boolean) => {
    setToolAiSaving(true);
    try {
      await api.put("/api/tool-ai/admin/config", { student_allowed: v });
      setToolAiStudent(v);
    } catch (e: any) {
      alert(e?.detail || "변경 실패");
    } finally {
      setToolAiSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/api/chatbot/config", cfg);
      alert("저장되었습니다");
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string, v: string) => setCfg({ ...cfg, [k]: v });

  const modelsForProvider = (p: string) => models.filter((m) => m.provider === p);

  return (
    <div className="max-w-3xl">
      <h1 className="text-title text-text-primary mb-2">챗봇 기본 설정</h1>
      <p className="text-caption text-text-tertiary mb-6">
        교사/학생 챗봇의 기본 모델, 권한, 한도를 설정합니다. 변경 즉시 반영됩니다.
      </p>

      <div className="bg-bg-primary border border-border-default rounded-lg divide-y divide-border-default">
        {FIELDS.map((f) => (
          <div key={f.key} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <label className="text-body font-medium text-text-primary">{f.label}</label>
                {f.help && <div className="text-caption text-text-tertiary mt-0.5">{f.help}</div>}
              </div>
              <div className="w-64 flex-shrink-0">
                {f.type === "bool" ? (
                  <input
                    type="checkbox"
                    checked={cfg[f.key] === "true"}
                    onChange={(e) => set(f.key, e.target.checked ? "true" : "false")}
                    className="w-5 h-5"
                  />
                ) : f.type === "select" ? (
                  <select
                    value={cfg[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full px-3 py-1.5 border border-border-default rounded text-body"
                  >
                    {providers.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : f.type === "number" ? (
                  <input
                    type="number"
                    value={cfg[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full px-3 py-1.5 border border-border-default rounded text-body"
                  />
                ) : f.key.startsWith("default_model_") ? (
                  <select
                    value={cfg[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full px-3 py-1.5 border border-border-default rounded text-body"
                  >
                    <option value="">-- 선택 --</option>
                    {(() => {
                      const audience = f.key.replace("default_model_", "");
                      const provKey = `default_provider_${audience}`;
                      return modelsForProvider(cfg[provKey] || "").map((m) => (
                        <option key={m.model_id} value={m.model_id}>{m.display_name}</option>
                      ));
                    })()}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={cfg[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full px-3 py-1.5 border border-border-default rounded text-body font-mono text-caption"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-6 flex items-center gap-2 px-5 py-2 bg-accent text-white rounded text-body disabled:opacity-50"
      >
        <Save size={16} />
        {saving ? "저장 중..." : "저장"}
      </button>

      {/* AI 도우미 — 문서/시트/슬라이드/설문 작성 보조 (별도 endpoint, 즉시 반영) */}
      <h2 className="text-title text-text-primary mt-10 mb-2">AI 도우미 (문서·시트·슬라이드·설문)</h2>
      <p className="text-caption text-text-tertiary mb-4">
        교사·직원은 기본 사용 가능. 학생은 기본 차단되어 있고, 아래 토글로 허용할 수 있습니다.
        토글 변경 시 student role의 `tool.ai_assistant.use` 권한이 즉시 부여/회수됩니다.
      </p>
      <div className="bg-bg-primary border border-border-default rounded-lg p-4 flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-body font-medium text-text-primary">학생도 AI 도우미 사용 허용</div>
          <div className="text-caption text-text-tertiary mt-0.5">
            끄면 학생 페이지에서 AI 도우미 버튼이 노출되지 않고 endpoint도 403으로 차단됩니다.
            켜면 비용 통제를 위해 학생 가능 모델은 `/system/llm/models`의 AI 도우미 토글에서
            저렴한 것(haiku, gpt-4o-mini 등)만 켜는 것을 권장합니다.
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={toolAiStudent}
            disabled={toolAiSaving}
            onChange={(e) => toggleToolAiStudent(e.target.checked)}
            className="w-5 h-5 accent-[#673ab7]"
          />
          <span className="text-caption text-text-secondary">{toolAiSaving ? "저장 중..." : (toolAiStudent ? "ON" : "OFF")}</span>
        </label>
      </div>
    </div>
  );
}
