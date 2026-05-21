"use client";

/**
 * Google OAuth 통합 설정 (super_admin 전용).
 *
 * 필요한 값:
 *  - Client ID, Client Secret: Google Cloud Console에서 발급
 *  - Redirect URI: https://{학교 도메인}/api/google/callback
 *  - Authorized scope: drive.readonly, drive.file, userinfo.email/profile
 *
 * 학교가 Workspace를 안 써도 일반 Gmail로도 OAuth 가능. 사용자 동의 흐름.
 */

import { useEffect, useState } from "react";
import { Globe, Eye, EyeOff, ExternalLink, CheckCircle2, Sparkles } from "lucide-react";
import { api } from "@/lib/api/client";
import { GoogleSetupWizard } from "@/components/google/GoogleSetupWizard";

export default function GoogleIntegrationPage() {
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [preview, setPreview] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  const reloadConfig = async () => {
    try {
      const r = await api.get<any>("/api/google/config");
      setConfigured(r.configured);
      setEnabled(r.enabled);
      setPreview(r.client_id_preview || "");
    } catch {}
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<any>("/api/google/config");
        setConfigured(r.configured);
        setEnabled(r.enabled);
        setPreview(r.client_id_preview || "");
        setRedirectUri(r.redirect_uri || `${window.location.origin}/api/google/callback`);
      } catch {}
    })();
  }, []);

  const save = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !redirectUri.trim()) {
      alert("Client ID, Client Secret, Redirect URI 모두 필요합니다");
      return;
    }
    setSaving(true);
    try {
      await api.put("/api/google/config", {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        redirect_uri: redirectUri.trim(),
        enabled,
      });
      setConfigured(true);
      setSaved(true);
      setClientSecret("");  // secret은 화면에서 즉시 제거
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      alert(e?.message || "저장 실패");
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Globe size={20} className="text-text-primary" />
          <h1 className="text-title text-text-primary">Google 연동</h1>
        </div>
        <p className="text-caption text-text-tertiary">
          사용자가 본인 Google 계정으로 Drive 파일을 조회·import·export 할 수 있습니다.
          미연동 시 학교 자체 드라이브만 사용 가능합니다.
        </p>
      </div>

      {/* 마법사 추천 — 처음이거나 다른 사람 인계 시 */}
      <div className="mb-5 p-4 bg-[#ede7f6] border border-[#673ab7]/30 rounded-lg flex items-center gap-3">
        <Sparkles size={20} className="text-[#673ab7] flex-shrink-0" />
        <div className="flex-1">
          <div className="text-body font-medium text-text-primary">처음 셋업하시나요?</div>
          <div className="text-caption text-text-secondary">
            마법사가 단계별로 안내합니다 (5~10분). Google Cloud Console 링크와 복사할 값을 자동으로 준비.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowWizard(true)}
          className="px-4 py-2 text-caption bg-[#673ab7] text-white rounded hover:bg-[#5e35b1] inline-flex items-center gap-1.5 flex-shrink-0"
        >
          <Sparkles size={13} /> 마법사 시작
        </button>
      </div>

      <div className="bg-cream-100 border border-cream-200 rounded-lg p-4 mb-5">
        <h3 className="text-body font-semibold text-text-primary mb-2">셋업 안내 (수동)</h3>
        <ol className="text-[13px] text-text-secondary space-y-1.5 list-decimal ml-4">
          <li>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-1"
            >
              Google Cloud Console <ExternalLink size={11} />
            </a>{" "}
            → OAuth 2.0 Client ID 생성 (Application type: Web)
          </li>
          <li>
            Authorized redirect URI에 추가:
            <code className="ml-1 bg-bg-secondary px-1.5 py-0.5 rounded text-[11px]">
              {redirectUri || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/google/callback`}
            </code>
          </li>
          <li>발급된 Client ID / Client Secret을 아래 입력</li>
          <li>"활성화" 체크 후 저장</li>
          <li>Google Cloud Console에서 OAuth consent screen 설정 (필수): scope에 drive.readonly, drive.file, userinfo.email/profile</li>
        </ol>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5">
        <h3 className="text-body font-semibold text-text-primary mb-3">설정</h3>
        {configured && preview && (
          <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-[12px] flex items-center gap-2 text-emerald-800">
            <CheckCircle2 size={14} /> 현재 등록됨: <code>{preview}</code>
            {enabled ? <span className="text-[11px]">· 활성</span> : <span className="text-[11px] text-red-600">· 비활성</span>}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={configured ? "(저장된 값 유지하려면 비워두세요)" : "xxxx.apps.googleusercontent.com"}
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary font-mono"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Client Secret</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={configured ? "(저장된 값 유지하려면 비워두세요)" : "GOCSPX-..."}
                className="w-full px-3 py-2 pr-10 text-[13px] border border-border-default rounded bg-bg-primary font-mono"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
              >
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Redirect URI</label>
            <input
              type="text"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder="https://{학교 도메인}/api/google/callback"
              className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary font-mono"
            />
            <div className="text-[11px] text-text-tertiary mt-1">
              Google Cloud Console의 Authorized redirect URIs에 정확히 일치하게 등록해야 합니다.
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="text-[13px] text-text-primary">활성화 (사용자가 본인 계정 연결 가능)</span>
          </label>
          <div className="pt-3 border-t border-border-default flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !clientId.trim() || !clientSecret.trim()}
              className="px-4 py-2 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            {saved && <span className="text-emerald-600 text-[12px]">✓ 저장 완료</span>}
          </div>
        </div>
      </div>

      <div className="mt-5 text-[12px] text-text-tertiary">
        💡 본 설정 후 모든 사용자가 본인 프로필에서 "Google 계정 연결" 버튼을 사용할 수 있습니다.
        Google Workspace를 쓰지 않는 학교도 일반 Gmail로 동일하게 동작합니다.
      </div>

      {showWizard && (
        <GoogleSetupWizard
          initialRedirectUri={redirectUri || (typeof window !== "undefined" ? `${window.location.origin}/api/google/callback` : "")}
          onClose={() => setShowWizard(false)}
          onSaved={() => { reloadConfig(); }}
        />
      )}
    </div>
  );
}
