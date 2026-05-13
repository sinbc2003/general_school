"use client";

import { useEffect, useState } from "react";
import { Key, Check, X, RefreshCw, AlertCircle } from "lucide-react";
import { api } from "@/lib/api/client";

interface ProviderRow {
  provider: string;
  is_active: boolean;
  api_key_masked: string;
  has_key: boolean;
  last_tested_at: string | null;
  last_test_ok: boolean;
  last_test_error: string | null;
  notes: string | null;
}

const LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
};

const HELP: Record<string, { url: string; placeholder: string }> = {
  openai: { url: "https://platform.openai.com/api-keys", placeholder: "sk-proj-..." },
  anthropic: { url: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-..." },
  google: { url: "https://aistudio.google.com/apikey", placeholder: "AIza..." },
};

export default function LLMProvidersPage() {
  const [items, setItems] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await api.get("/api/chatbot/providers");
    setItems(data.items);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (provider: string, body: any) => {
    setSaving(provider);
    try {
      await api.put(`/api/chatbot/providers/${provider}`, body);
      setEditing((p) => { const n = { ...p }; delete n[provider]; return n; });
      await load();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(null);
    }
  };

  const test = async (provider: string) => {
    setTesting(provider);
    try {
      const res = await api.post(`/api/chatbot/providers/${provider}/test`);
      alert(res.ok ? "✓ 연결 성공" : `✗ 실패: ${res.error}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "테스트 실패");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-title text-text-primary mb-2">LLM Provider / API 키</h1>
      <p className="text-caption text-text-tertiary mb-6">
        API 키는 Fernet으로 암호화되어 저장됩니다. is_active를 켜야 챗봇에서 사용 가능합니다.
      </p>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : (
        <div className="space-y-4">
          {items.map((p) => (
            <div key={p.provider} className="bg-bg-primary border border-border-default rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Key size={16} className="text-accent" />
                    <h3 className="text-body font-semibold text-text-primary">
                      {LABEL[p.provider] || p.provider}
                    </h3>
                    {p.is_active && p.has_key && (
                      <span className="px-2 py-0.5 bg-accent-light text-accent text-caption rounded">활성</span>
                    )}
                    {!p.is_active && p.has_key && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-caption rounded">비활성</span>
                    )}
                    {!p.has_key && (
                      <span className="px-2 py-0.5 bg-status-warning-light text-status-warning text-caption rounded">키 없음</span>
                    )}
                  </div>
                  <a
                    href={HELP[p.provider]?.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-caption text-accent hover:underline"
                  >
                    API 키 발급 페이지 ↗
                  </a>
                </div>
                <div className="flex gap-2">
                  {p.has_key && (
                    <button
                      onClick={() => test(p.provider)}
                      disabled={testing === p.provider}
                      className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={testing === p.provider ? "animate-spin" : ""} />
                      연결 테스트
                    </button>
                  )}
                  <button
                    onClick={() => save(p.provider, { is_active: !p.is_active })}
                    disabled={!p.has_key || saving === p.provider}
                    className={`px-3 py-1.5 text-caption rounded ${
                      p.is_active ? "bg-status-warning text-white" : "bg-accent text-white"
                    } disabled:opacity-40`}
                  >
                    {p.is_active ? "비활성화" : "활성화"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-caption text-text-secondary block mb-1">API 키</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={editing[p.provider] ?? ""}
                      onChange={(e) => setEditing({ ...editing, [p.provider]: e.target.value })}
                      placeholder={p.api_key_masked || HELP[p.provider]?.placeholder}
                      className="flex-1 px-3 py-2 text-body border border-border-default rounded font-mono"
                    />
                    {editing[p.provider] && (
                      <button
                        onClick={() => save(p.provider, { api_key: editing[p.provider] })}
                        disabled={saving === p.provider}
                        className="px-4 py-2 bg-accent text-white text-body rounded disabled:opacity-50"
                      >
                        저장
                      </button>
                    )}
                  </div>
                  {p.has_key && !editing[p.provider] && (
                    <div className="text-caption text-text-tertiary mt-1">현재: {p.api_key_masked}</div>
                  )}
                </div>
                <div>
                  <label className="text-caption text-text-secondary block mb-1">테스트 결과</label>
                  {p.last_tested_at ? (
                    <div className="flex items-start gap-2 px-3 py-2 border border-border-default rounded bg-bg-secondary">
                      {p.last_test_ok ? (
                        <Check size={14} className="text-status-success mt-0.5" />
                      ) : (
                        <X size={14} className="text-status-error mt-0.5" />
                      )}
                      <div className="flex-1 text-caption">
                        <div>{new Date(p.last_tested_at).toLocaleString("ko-KR")}</div>
                        {p.last_test_error && <div className="text-status-error mt-1">{p.last_test_error}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="text-caption text-text-tertiary px-3 py-2 border border-dashed border-border-default rounded">
                      아직 테스트되지 않음
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
