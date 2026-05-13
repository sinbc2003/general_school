"use client";

import { useEffect, useState } from "react";
import { Settings, School, Flag, Bell, Database, Image as ImageIcon, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

export default function SystemSettingsPage() {
  return (
    <div>
      <h1 className="text-title text-text-primary mb-6">시스템 설정</h1>

      <div className="space-y-6">
        {/* 사이트 브랜딩 — 최고관리자 전용 */}
        <BrandingSection />

        {/* 기능 플래그 */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-6">
          <div className="flex items-center gap-2 mb-4">
            <Flag size={18} className="text-status-warning" />
            <h2 className="text-body font-semibold text-text-primary">
              기능 플래그
            </h2>
          </div>
          <div className="space-y-3">
            {[
              { key: "papers", label: "논문 시스템", desc: "논문 크롤링 및 뉴스레터" },
              { key: "timetable", label: "시간표", desc: "시간표 관리" },
              { key: "contest", label: "대회 관리", desc: "수학 대회 운영" },
            ].map((feat) => (
              <div
                key={feat.key}
                className="flex items-center justify-between py-2 border-b border-border-default last:border-0"
              >
                <div>
                  <div className="text-body text-text-primary">{feat.label}</div>
                  <div className="text-caption text-text-tertiary">
                    {feat.desc}
                  </div>
                </div>
                <div className="w-10 h-5 bg-bg-secondary rounded-full relative cursor-not-allowed opacity-50">
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 알림 설정 */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-6">
          <div className="flex items-center gap-2 mb-4">
            <Bell size={18} className="text-accent" />
            <h2 className="text-body font-semibold text-text-primary">
              알림 설정
            </h2>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between py-2 border-b border-border-default">
              <span className="text-body text-text-primary">이메일 알림</span>
              <div className="w-10 h-5 bg-bg-secondary rounded-full relative cursor-not-allowed opacity-50">
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-body text-text-primary">시스템 알림</span>
              <div className="w-10 h-5 bg-bg-secondary rounded-full relative cursor-not-allowed opacity-50">
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
              </div>
            </div>
          </div>
        </div>

        {/* 데이터 관리 */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database size={18} className="text-status-error" />
            <h2 className="text-body font-semibold text-text-primary">
              데이터 관리
            </h2>
          </div>
          <div className="space-y-2">
            <button
              disabled
              className="px-4 py-1.5 text-body border border-border-default rounded text-text-tertiary cursor-not-allowed"
            >
              데이터 백업
            </button>
            <button
              disabled
              className="ml-2 px-4 py-1.5 text-body border border-border-default rounded text-text-tertiary cursor-not-allowed"
            >
              캐시 초기화
            </button>
          </div>
        </div>

        {/* 안내 */}
        <div className="p-4 bg-bg-secondary rounded-lg border border-border-default">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-text-tertiary" />
            <span className="text-body text-text-secondary">
              기능 플래그·알림·데이터 관리는 추후 구현됩니다.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── 사이트 브랜딩 섹션 ──
function BrandingSection() {
  const { isSuperAdmin } = useAuth();
  const [title, setTitle] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/system/branding");
      setTitle(data.title || "");
      setSchoolName(data.school_name || "");
      setFaviconUrl(data.favicon_url || null);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveText = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.put("/api/system/branding", { title, school_name: schoolName });
      setMsg({ type: "ok", text: "저장되었습니다. 브라우저 탭을 새로고침하면 반영됩니다." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.detail || "저장 실패" });
    } finally {
      setSaving(false);
    }
  };

  const uploadFavicon = async (file: File) => {
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await api.fetch<any>("/api/system/branding/favicon", {
        method: "POST", body: fd,
      });
      setFaviconUrl(data.favicon_url);
      setMsg({ type: "ok", text: "파비콘이 업로드되었습니다. 브라우저 탭 새로고침 시 반영됩니다." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.detail || "업로드 실패" });
    } finally {
      setUploading(false);
    }
  };

  const removeFavicon = async () => {
    if (!confirm("파비콘을 제거하시겠습니까?")) return;
    try {
      await api.delete("/api/system/branding/favicon");
      setFaviconUrl(null);
      setMsg({ type: "ok", text: "파비콘이 제거되었습니다." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.detail || "제거 실패" });
    }
  };

  const previewSrc = faviconUrl ? `${API_URL}${faviconUrl}` : null;

  return (
    <div className="bg-bg-primary rounded-lg border border-border-default p-6">
      <div className="flex items-center gap-2 mb-4">
        <ImageIcon size={18} className="text-accent" />
        <h2 className="text-body font-semibold text-text-primary">사이트 브랜딩</h2>
        <span className="ml-auto text-caption text-text-tertiary">최고관리자 전용</span>
      </div>

      {!isSuperAdmin && (
        <div className="mb-3 p-3 bg-status-warning-light text-status-warning text-caption rounded">
          이 항목은 조회만 가능합니다. 변경은 최고관리자에게 요청하세요.
        </div>
      )}

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : (
        <div className="space-y-4">
          {/* 탭 제목 */}
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              브라우저 탭 제목
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!isSuperAdmin}
              placeholder="예: 한빛고등학교 통합 플랫폼"
              className="w-full max-w-md px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary disabled:bg-bg-secondary disabled:text-text-tertiary"
            />
            <p className="text-caption text-text-tertiary mt-1">
              브라우저 탭에 표시되는 페이지 제목. 변경 시 새로고침 필요.
            </p>
          </div>

          {/* 학교 이름 */}
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              학교 이름 (UI 표시용)
            </label>
            <input
              type="text"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              disabled={!isSuperAdmin}
              placeholder="예: 한빛고등학교"
              className="w-full max-w-md px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary disabled:bg-bg-secondary disabled:text-text-tertiary"
            />
            <p className="text-caption text-text-tertiary mt-1">
              생기부 PDF, 헬스체크, 시스템 안내 등 학교 이름이 들어가는 곳에 사용.
            </p>
          </div>

          {isSuperAdmin && (
            <button
              onClick={saveText}
              disabled={saving}
              className="flex items-center gap-1 px-4 py-1.5 bg-accent text-white rounded text-body disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? "저장 중..." : "텍스트 저장"}
            </button>
          )}

          {/* 파비콘 */}
          <div className="pt-4 border-t border-border-default">
            <label className="block text-caption text-text-secondary mb-2">
              파비콘 (브라우저 탭 아이콘)
            </label>
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 border border-border-default rounded flex items-center justify-center bg-bg-secondary">
                {previewSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewSrc} alt="favicon" className="max-w-full max-h-full" />
                ) : (
                  <ImageIcon size={24} className="text-text-tertiary" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-caption text-text-tertiary mb-2">
                  PNG, ICO, SVG, JPG 지원. 권장 크기 32×32 또는 64×64. 최대 1MB.
                </p>
                {isSuperAdmin && (
                  <div className="flex gap-2">
                    <label className={`inline-flex items-center gap-1 px-3 py-1.5 text-body border border-border-default rounded ${uploading ? "opacity-50" : "cursor-pointer hover:bg-bg-secondary"}`}>
                      <ImageIcon size={14} />
                      {uploading ? "업로드 중..." : "파일 선택"}
                      <input
                        type="file"
                        accept=".ico,.png,.svg,.jpg,.jpeg,image/*"
                        disabled={uploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadFavicon(f);
                          e.currentTarget.value = "";
                        }}
                        className="hidden"
                      />
                    </label>
                    {faviconUrl && (
                      <button
                        onClick={removeFavicon}
                        className="flex items-center gap-1 px-3 py-1.5 text-body text-status-error border border-status-error rounded hover:bg-status-error-light"
                      >
                        <Trash2 size={14} /> 제거
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {msg && (
            <div className={`p-3 rounded text-caption ${
              msg.type === "ok"
                ? "bg-status-success-light text-status-success"
                : "bg-status-error-light text-status-error"
            }`}>
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
