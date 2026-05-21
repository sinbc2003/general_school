"use client";

/**
 * Google OAuth 셋업 마법사 — 비기술 관리자도 5~10분에 끝낼 수 있게 단계별.
 *
 * Google Cloud Console 자체 단계는 외부 사이트라 자동화 불가 — 각 단계
 * 마다 외부 링크(새 탭) + 필요한 값 + 복사 버튼을 제공해서 실수 최소화.
 *
 * 단계:
 *  1. 환영 + 무엇을 할지 안내
 *  2. Google Cloud 프로젝트 생성
 *  3. OAuth Consent Screen 설정 (External, App name, Test users)
 *  4. Drive API 활성화
 *  5. OAuth Client ID 생성 (Web + redirect URI 복사)
 *  6. Client ID/Secret 입력 + 형식 검증 + 저장
 *  7. 완료
 *
 * 저장 후 `/api/google/auth-url` 호출 시도해 503 안 나면 정상 등록 표시.
 */

import { useEffect, useState } from "react";
import {
  ChevronLeft, ChevronRight, Check, ExternalLink, Copy, AlertTriangle,
  Sparkles, Loader2,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface Props {
  initialRedirectUri: string;
  onClose: () => void;
  onSaved: () => void;
}

export function GoogleSetupWizard({
  initialRedirectUri, onClose, onSaved,
}: Props) {
  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState(initialRedirectUri);
  const [appName, setAppName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // 기본 redirect URI — origin 기반 자동
  useEffect(() => {
    if (!initialRedirectUri && typeof window !== "undefined") {
      setRedirectUri(`${window.location.origin}/api/google/callback`);
    }
  }, [initialRedirectUri]);

  const isValidClientId = clientId.trim().endsWith(".apps.googleusercontent.com");
  const canSave = isValidClientId && clientSecret.trim().length > 5 && redirectUri.trim().length > 5;

  const save = async () => {
    setSaving(true);
    setTestError(null);
    try {
      await api.put("/api/google/config", {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        redirect_uri: redirectUri.trim(),
        enabled: true,
      });
      // 연결 테스트 — auth-url 호출해 503 안 나면 OK
      try {
        await api.get("/api/google/auth-url");
        setSavedOk(true);
        setStep(6);
        onSaved();
      } catch (e: any) {
        setTestError(`저장은 됐지만 검증 실패: ${e?.detail || e?.message || "알 수 없음"}`);
      }
    } catch (e: any) {
      setTestError(e?.detail || e?.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const STEPS = [
    { label: "시작", title: "Google 연동 셋업" },
    { label: "프로젝트", title: "1. Google Cloud 프로젝트 만들기" },
    { label: "동의 화면", title: "2. OAuth Consent Screen 설정" },
    { label: "Drive API", title: "3. Google Drive API 활성화" },
    { label: "OAuth Client", title: "4. OAuth Client ID 생성" },
    { label: "입력·저장", title: "5. Client ID·Secret 입력" },
    { label: "완료", title: "셋업 완료" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border-default flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-[#ede7f6] flex items-center justify-center">
            <Sparkles size={18} className="text-[#673ab7]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-body font-semibold">{STEPS[step].title}</div>
            <div className="text-caption text-text-tertiary">
              단계 {step + 1} / {STEPS.length}
            </div>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary px-2 py-1 text-caption">닫기</button>
        </div>

        {/* Stepper bar */}
        <div className="px-6 py-3 border-b border-border-default flex items-center gap-1.5 flex-shrink-0 overflow-x-auto">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10.5px] font-medium ${
                  i < step ? "bg-emerald-500 text-white"
                  : i === step ? "bg-[#673ab7] text-white"
                  : "bg-bg-secondary text-text-tertiary"
                }`}
              >
                {i < step ? <Check size={11} /> : i + 1}
              </div>
              <span className={`text-[11px] ${i === step ? "text-text-primary font-medium" : "text-text-tertiary"}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <div className="w-3 h-px bg-border-default" />}
            </div>
          ))}
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-body">
          {step === 0 && (
            <div className="space-y-3 text-text-secondary">
              <p>이 마법사는 약 <strong className="text-text-primary">5~10분</strong> 정도 걸립니다. 5단계만 따라 하면 됩니다.</p>
              <p>완료하면 학교 모든 사용자가 본인 Gmail로 Google Drive를 연결해 파일을 가져올 수 있어요.</p>
              <Note kind="info">
                Google Cloud Console에 접속할 수 있는 Google 계정이 하나 필요합니다 (어떤 Gmail이든 OK).
              </Note>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3 text-text-secondary">
              <Link href="https://console.cloud.google.com/projectcreate" label="Google Cloud Console — 새 프로젝트 만들기" />
              <ol className="list-decimal ml-5 space-y-1.5">
                <li>위 링크를 새 탭에서 엽니다.</li>
                <li>Project name에 학교명 (예: <code className="text-[12px] bg-bg-secondary px-1.5 rounded">{appName || "OO고등학교 플랫폼"}</code>) 입력.</li>
                <li>Organization은 비워둬도 됨 ("No organization").</li>
                <li>[CREATE] 클릭 후 잠시 기다리면 생성 완료. 좌상단 프로젝트 선택 드롭다운에서 방금 만든 프로젝트가 활성화돼있는지 확인.</li>
              </ol>
              <div className="pt-2">
                <label className="block text-[12px] text-text-tertiary mb-1">참고용 — 학교명 (선택)</label>
                <input
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="예: 경기과학고등학교"
                  className="w-full px-3 py-1.5 border border-border-default rounded text-body"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3 text-text-secondary">
              <Link href="https://console.cloud.google.com/apis/credentials/consent" label="OAuth consent screen 페이지 열기" />
              <ol className="list-decimal ml-5 space-y-1.5">
                <li>User Type: <strong>External</strong> 선택 → [CREATE]</li>
                <li>App information:
                  <ul className="list-disc ml-5 mt-1 space-y-0.5 text-[12.5px]">
                    <li>App name: <code className="text-[12px] bg-bg-secondary px-1.5 rounded">{appName || "학교 이름"}</code></li>
                    <li>User support email: 본인 Gmail</li>
                    <li>Developer contact info: 본인 Gmail</li>
                  </ul>
                </li>
                <li>[SAVE AND CONTINUE] (scope는 비워둬도 됨)</li>
                <li><strong>Test users</strong> 페이지에서 <strong className="text-amber-700">사용할 모든 Gmail 추가</strong> (본인 + 테스트할 교사·학생).
                  <Note kind="warn">
                    Testing 상태에선 Test users로 등록된 사람만 OAuth 가능. 나중에 "Publish App" 하면 전체 공개 (검수 필요할 수도).
                  </Note>
                </li>
                <li>[SAVE AND CONTINUE] → Summary → [BACK TO DASHBOARD]</li>
              </ol>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-text-secondary">
              <Link href="https://console.cloud.google.com/apis/library/drive.googleapis.com" label="Google Drive API 페이지 열기" />
              <ol className="list-decimal ml-5 space-y-1.5">
                <li>위 링크를 새 탭에서 엽니다 (방금 만든 프로젝트가 선택된 상태로).</li>
                <li>[ENABLE] 파란 버튼 클릭.</li>
                <li>"API enabled" 메시지가 나오면 완료.</li>
              </ol>
              <Note kind="info">
                Drive API가 활성화되어야 사용자가 Google Drive 파일을 조회/import 할 수 있습니다.
              </Note>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-text-secondary">
              <Link href="https://console.cloud.google.com/apis/credentials" label="Credentials 페이지 열기" />
              <ol className="list-decimal ml-5 space-y-1.5">
                <li>상단 [+ CREATE CREDENTIALS] → <strong>OAuth client ID</strong></li>
                <li>Application type: <strong className="text-amber-700">Web application</strong> ← 다른 거 선택하면 안 됨</li>
                <li>Name: <code className="text-[12px] bg-bg-secondary px-1.5 rounded">학교 플랫폼</code> (아무거나)</li>
                <li>Authorized redirect URIs → [+ ADD URI] → 아래 값 정확히 붙여넣기:
                  <div className="mt-2 flex items-center gap-2 bg-bg-secondary rounded p-2">
                    <code className="flex-1 text-[12px] font-mono break-all">{redirectUri}</code>
                    <button
                      type="button"
                      onClick={() => copy(redirectUri)}
                      className="px-2 py-1 text-[11px] bg-accent text-white rounded hover:opacity-90 inline-flex items-center gap-1"
                    >
                      <Copy size={11} /> 복사
                    </button>
                  </div>
                </li>
                <li>[CREATE] 클릭 → <strong>OAuth client created</strong> 팝업에서 Client ID + Client secret 표시됨. 두 값을 메모장에 복사 (다음 단계에서 입력).</li>
              </ol>
              <Note kind="warn">
                Application type을 "Desktop app" 같은 다른 걸로 선택하면 invalid_client 에러가 납니다. 반드시 <strong>Web application</strong>.
              </Note>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4 text-text-secondary">
              <div>
                <label className="block text-[12px] text-text-tertiary mb-1">Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234567890-abcxxxxx.apps.googleusercontent.com"
                  className="w-full px-3 py-2 border border-border-default rounded font-mono text-[12.5px]"
                />
                {clientId && !isValidClientId && (
                  <div className="text-[11.5px] text-amber-700 mt-1 inline-flex items-center gap-1">
                    <AlertTriangle size={11} />
                    `.apps.googleusercontent.com` 으로 끝나야 합니다. 복사할 때 잘렸을 가능성.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[12px] text-text-tertiary mb-1">Client Secret</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-..."
                  className="w-full px-3 py-2 border border-border-default rounded font-mono text-[12.5px]"
                />
              </div>
              <div>
                <label className="block text-[12px] text-text-tertiary mb-1">Redirect URI (자동)</label>
                <input
                  type="text"
                  value={redirectUri}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  className="w-full px-3 py-2 border border-border-default rounded font-mono text-[12.5px] bg-bg-secondary"
                />
                <div className="text-[11.5px] text-text-tertiary mt-1">
                  Google Cloud Console에서 입력한 URI와 정확히 같아야 합니다 (4단계).
                </div>
              </div>
              {testError && (
                <Note kind="warn">{testError}</Note>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3 text-text-secondary">
              <div className="flex items-center gap-2 text-emerald-700">
                <Check size={20} />
                <strong className="text-body">셋업 완료!</strong>
              </div>
              <p>이제 모든 사용자가 본인 드라이브 페이지의 <strong>"Google 계정 연결"</strong> 버튼을 사용할 수 있습니다.</p>
              <Note kind="info">
                다른 사람이 사용하려면 OAuth Consent Screen의 <strong>Test users</strong>에 그 Gmail이 등록되어 있어야 합니다.
                전체 공개하려면 Google Cloud Console에서 [Publish App]을 누르세요 (검수 절차가 필요할 수 있음).
              </Note>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-border-default flex items-center justify-between gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || step === 6}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-caption text-text-secondary hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronLeft size={13} /> 이전
          </button>
          {step < 5 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="inline-flex items-center gap-1 px-4 py-1.5 text-caption bg-[#673ab7] text-white rounded hover:bg-[#5e35b1]"
            >
              다음 <ChevronRight size={13} />
            </button>
          ) : step === 5 ? (
            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-caption bg-[#673ab7] text-white rounded hover:bg-[#5e35b1] disabled:opacity-40"
            >
              {saving ? <><Loader2 size={13} className="animate-spin" /> 저장+검증 중...</> : <>저장하고 검증 <Check size={13} /></>}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 px-4 py-1.5 text-caption bg-emerald-600 text-white rounded hover:bg-emerald-700"
            >
              마치기 <Check size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function Link({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent rounded font-medium text-body"
    >
      <ExternalLink size={14} /> {label}
    </a>
  );
}

function Note({ kind, children }: { kind: "info" | "warn"; children: React.ReactNode }) {
  const cls = kind === "warn"
    ? "bg-amber-50 border-amber-200 text-amber-900"
    : "bg-cream-100 border-cream-300 text-text-secondary";
  return (
    <div className={`text-[12.5px] border rounded px-3 py-2 ${cls}`}>
      {children}
    </div>
  );
}
