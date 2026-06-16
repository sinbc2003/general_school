"use client";

/** PDF 도구 / Mathpix 설정 — PDF→HWPX 변환에 쓰는 Mathpix OCR API 키 (admin). */

import { useEffect, useState } from "react";
import { FileType2, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api/client";

export default function MathpixIntegrationPage() {
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [keyPreview, setKeyPreview] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<any>("/api/tools/office/mathpix-config");
        setConfigured(r.configured);
        setEnabled(r.enabled);
        setAppId(r.app_id || "");
        setKeyPreview(r.app_key_preview || "");
      } catch {
        /* 권한 없음 등 — 빈 상태 */
      }
    })();
  }, []);

  const save = async () => {
    if (!appId.trim()) {
      alert("App ID가 필요합니다");
      return;
    }
    setSaving(true);
    try {
      await api.put("/api/tools/office/mathpix-config", {
        app_id: appId.trim(),
        app_key: appKey.trim(), // 비워두면 기존 키 유지
        enabled,
      });
      setConfigured(true);
      setSaved(true);
      setAppKey("");
      setKeyPreview("•••• 저장됨");
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-2">
        <FileType2 size={20} className="text-blue-600" />
        <h1 className="text-title font-semibold text-text-primary">PDF 도구 / Mathpix</h1>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5">
        <h3 className="text-body font-semibold text-text-primary mb-1">Mathpix API 키</h3>
        <p className="text-caption text-text-tertiary mb-4">
          업무 도구의 <b>PDF → HWPX 변환</b>이 수식 인식에 Mathpix OCR을 사용합니다.{" "}
          <a href="https://mathpix.com/" target="_blank" rel="noopener noreferrer" className="underline">
            mathpix.com
          </a>{" "}
          → Console → API Keys에서 App ID / App Key를 발급받아 입력하세요.
        </p>

        {configured && keyPreview && (
          <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-[12px] flex items-center gap-2 text-emerald-800">
            <CheckCircle2 size={14} /> 현재 등록됨: <code>{keyPreview}</code>
            {enabled ? (
              <span className="text-[11px]">· 활성</span>
            ) : (
              <span className="text-[11px] text-red-600">· 비활성</span>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">App ID</label>
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="mathpix app_id"
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary font-mono"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">App Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                placeholder={configured ? "(저장된 값 유지하려면 비워두세요)" : "mathpix app_key"}
                className="w-full px-3 py-2 pr-10 text-[13px] border border-border-default rounded bg-bg-primary font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="text-[13px] text-text-primary">활성화 (끄면 변환 도구가 잠깁니다)</span>
          </label>
          <div className="pt-3 border-t border-border-default flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !appId.trim()}
              className="px-4 py-2 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            {saved && <span className="text-emerald-600 text-[12px]">✓ 저장 완료</span>}
          </div>
        </div>

        <p className="mt-4 text-[11px] text-text-tertiary leading-relaxed">
          App Key는 Fernet으로 암호화되어 저장되며 화면에는 마스킹되어 표시됩니다. 학교 서버가
          외부(api.mathpix.com)로 나가지 못하는 망이면 변환이 실패할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
