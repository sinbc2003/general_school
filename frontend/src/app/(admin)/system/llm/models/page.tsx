"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, DollarSign } from "lucide-react";
import { api } from "@/lib/api/client";

interface ModelRow {
  id: number;
  provider: string;
  model_id: string;
  display_name: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  context_window: number | null;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
}

const PROVIDERS = ["openai", "anthropic", "google"];

export default function LLMModelsPage() {
  const [items, setItems] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newRow, setNewRow] = useState<Partial<ModelRow>>({
    provider: "anthropic", model_id: "", display_name: "",
    input_per_1m_usd: 0, output_per_1m_usd: 0, context_window: 200000,
    is_active: true, sort_order: 100,
  });

  const load = async () => {
    setLoading(true);
    const data = await api.get("/api/chatbot/models/all");
    setItems(data.items);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const update = async (id: number, body: any) => {
    await api.put(`/api/chatbot/models/${id}`, body);
    await load();
  };

  const create = async () => {
    if (!newRow.model_id) return alert("model_id 필수");
    await api.post("/api/chatbot/models", newRow);
    setShowCreate(false);
    setNewRow({ provider: "anthropic", model_id: "", display_name: "",
                input_per_1m_usd: 0, output_per_1m_usd: 0, context_window: 200000,
                is_active: true, sort_order: 100 });
    await load();
  };

  const remove = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await api.delete(`/api/chatbot/models/${id}`);
    await load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary mb-1">LLM 모델 / 단가</h1>
          <p className="text-caption text-text-tertiary">
            Provider별 사용 가능 모델과 단가 (USD per 1M tokens). 가격은 공식 사이트 기준 수동 갱신.
          </p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1 px-3 py-2 bg-accent text-white text-body rounded">
          <Plus size={14} /> 모델 추가
        </button>
      </div>

      {showCreate && (
        <div className="bg-accent-light border border-accent rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <select
            value={newRow.provider}
            onChange={(e) => setNewRow({ ...newRow, provider: e.target.value })}
            className="px-2 py-1.5 border border-border-default rounded"
          >
            {PROVIDERS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <input placeholder="model_id" value={newRow.model_id} onChange={(e) => setNewRow({ ...newRow, model_id: e.target.value })}
                 className="px-2 py-1.5 border border-border-default rounded" />
          <input placeholder="display_name" value={newRow.display_name} onChange={(e) => setNewRow({ ...newRow, display_name: e.target.value })}
                 className="px-2 py-1.5 border border-border-default rounded col-span-2" />
          <input type="number" step="0.01" placeholder="input/1M" value={newRow.input_per_1m_usd}
                 onChange={(e) => setNewRow({ ...newRow, input_per_1m_usd: parseFloat(e.target.value) })}
                 className="px-2 py-1.5 border border-border-default rounded" />
          <input type="number" step="0.01" placeholder="output/1M" value={newRow.output_per_1m_usd}
                 onChange={(e) => setNewRow({ ...newRow, output_per_1m_usd: parseFloat(e.target.value) })}
                 className="px-2 py-1.5 border border-border-default rounded" />
          <input type="number" placeholder="context window" value={newRow.context_window || ""}
                 onChange={(e) => setNewRow({ ...newRow, context_window: parseInt(e.target.value) || null })}
                 className="px-2 py-1.5 border border-border-default rounded" />
          <div className="flex gap-2">
            <button onClick={create} className="px-3 py-1.5 bg-accent text-white rounded">생성</button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 border border-border-default rounded">취소</button>
          </div>
        </div>
      )}

      {loading ? (
        <div>로딩 중...</div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-body">
            <thead className="bg-bg-secondary">
              <tr>
                <th className="px-3 py-2 text-left text-caption text-text-secondary">Provider</th>
                <th className="px-3 py-2 text-left text-caption text-text-secondary">Model ID</th>
                <th className="px-3 py-2 text-left text-caption text-text-secondary">표시명</th>
                <th className="px-3 py-2 text-right text-caption text-text-secondary">Input $/1M</th>
                <th className="px-3 py-2 text-right text-caption text-text-secondary">Output $/1M</th>
                <th className="px-3 py-2 text-right text-caption text-text-secondary">Context</th>
                <th className="px-3 py-2 text-center text-caption text-text-secondary">정렬</th>
                <th className="px-3 py-2 text-center text-caption text-text-secondary">활성</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t border-border-default hover:bg-bg-secondary">
                  <td className="px-3 py-2">{m.provider}</td>
                  <td className="px-3 py-2 font-mono text-caption">{m.model_id}</td>
                  <td className="px-3 py-2">
                    <input defaultValue={m.display_name} onBlur={(e) => e.target.value !== m.display_name && update(m.id, { display_name: e.target.value })}
                           className="px-1.5 py-0.5 border border-transparent hover:border-border-default rounded w-full" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" step="0.01" defaultValue={m.input_per_1m_usd}
                           onBlur={(e) => parseFloat(e.target.value) !== m.input_per_1m_usd && update(m.id, { input_per_1m_usd: parseFloat(e.target.value) })}
                           className="px-1.5 py-0.5 border border-transparent hover:border-border-default rounded text-right w-20" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" step="0.01" defaultValue={m.output_per_1m_usd}
                           onBlur={(e) => parseFloat(e.target.value) !== m.output_per_1m_usd && update(m.id, { output_per_1m_usd: parseFloat(e.target.value) })}
                           className="px-1.5 py-0.5 border border-transparent hover:border-border-default rounded text-right w-20" />
                  </td>
                  <td className="px-3 py-2 text-right text-caption">{m.context_window?.toLocaleString() || "-"}</td>
                  <td className="px-3 py-2 text-center">
                    <input type="number" defaultValue={m.sort_order} onBlur={(e) => parseInt(e.target.value) !== m.sort_order && update(m.id, { sort_order: parseInt(e.target.value) })}
                           className="px-1.5 py-0.5 border border-transparent hover:border-border-default rounded w-12 text-center" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={m.is_active} onChange={(e) => update(m.id, { is_active: e.target.checked })} />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => remove(m.id)} className="text-text-tertiary hover:text-status-error">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
