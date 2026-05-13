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

  useEffect(() => {
    Promise.all([
      api.get("/api/chatbot/config"),
      api.get("/api/chatbot/models/all"),
    ]).then(([c, m]) => {
      setCfg(c);
      setModels(m.items.filter((x: any) => x.is_active));
      setProviders(["openai", "anthropic", "google"]);
    });
  }, []);

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
    </div>
  );
}
