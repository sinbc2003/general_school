"use client";

/**
 * 코드 업데이트 확인 (`/system/updates`).
 * super_admin 전용. GitHub repo HEAD 비교 + 업데이트 가이드.
 *
 * 정책 (학교 자체 운영):
 *   - 자동 git pull 안 함 (alembic migration·테스트 미검증 코드 위험)
 *   - 알림만 띄우고 사용자가 수동 `git pull && systemctl restart gs-backend`
 */

import { useEffect, useState, useCallback } from "react";
import { Github, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface CommitInfo {
  sha: string;
  message: string;
  committed_at: string;
  html_url?: string;
  author?: string;
}

interface UpdateStatus {
  enabled: boolean;
  local: CommitInfo | null;
  remote: CommitInfo | null;
  commits: CommitInfo[];
  behind_count: number;
}

interface CheckResult {
  enabled: boolean;
  local: CommitInfo | null;
  remote: CommitInfo | null;
  behind_count: number;
  notified: boolean;
}

function shortSha(sha: string | null | undefined): string {
  if (!sha) return "-";
  return sha.slice(0, 7);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  } catch { return "-"; }
}

export default function UpdatesPage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<UpdateStatus>("/api/system/updates/status");
      setStatus(r);
    } catch (e: any) {
      setError(e?.detail || e?.message || "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    try {
      const r = await api.post<CheckResult>("/api/system/updates/check-now", {});
      // 결과 반영
      setStatus((prev) => prev ? {
        ...prev,
        local: r.local,
        remote: r.remote,
        behind_count: r.behind_count,
        enabled: r.enabled,
      } : null);
      setLastChecked(new Date().toLocaleString("ko-KR"));
      // 차이 commit list 새로 fetch (status endpoint가 신선한 commit list 반환)
      await load();
    } catch (e: any) {
      setError(e?.detail || e?.message || "확인 실패");
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12 text-text-tertiary">
          <Loader2 size={20} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Github size={22} className="text-text-primary" />
          <h1 className="text-title">코드 업데이트</h1>
        </div>
        {status?.enabled && (
          <button
            type="button"
            onClick={checkNow}
            disabled={checking}
            className="flex items-center gap-2 px-3 py-2 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {checking ? "확인 중..." : "지금 확인"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-caption text-red-700">
          {error}
        </div>
      )}

      {/* 환경변수 미설정 안내 */}
      {!status?.enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
          <div className="flex items-start gap-2 mb-2">
            <AlertCircle size={16} className="text-amber-700 mt-0.5" />
            <div className="text-body font-semibold text-amber-900">자동 업데이트 알림이 꺼져 있습니다</div>
          </div>
          <p className="text-caption text-amber-800 mb-3">
            <code className="px-1.5 py-0.5 bg-amber-100 rounded text-[12px]">GITHUB_UPDATE_REPO</code> 환경변수를 설정하면 GitHub 새 commit 자동 알림이 켜집니다.
          </p>
          <div className="bg-amber-100/50 border border-amber-300 rounded px-3 py-2 text-[11px] font-mono">
            <div># .env 또는 systemd EnvironmentFile에 추가</div>
            <div className="mt-1">GITHUB_UPDATE_REPO=<span className="text-amber-900 font-semibold">owner/repo</span></div>
            <div>GITHUB_UPDATE_BRANCH=main</div>
            <div>GITHUB_UPDATE_TOKEN=  <span className="text-amber-700"># (private repo만 필요)</span></div>
          </div>
          <p className="text-[11px] text-amber-700 mt-2">
            설정 후 backend 재시작 → 24시간마다 자동 polling 시작.
          </p>
        </div>
      )}

      {/* 동기화 상태 */}
      {status?.enabled && (
        <>
          <div className={`rounded-lg p-5 mb-4 ${
            status.behind_count === 0
              ? "bg-emerald-50 border border-emerald-200"
              : "bg-sky-50 border border-sky-200"
          }`}>
            <div className="flex items-center gap-2 mb-3">
              {status.behind_count === 0 ? (
                <>
                  <CheckCircle2 size={18} className="text-emerald-700" />
                  <h2 className="text-body font-semibold text-emerald-900">최신 상태입니다</h2>
                </>
              ) : (
                <>
                  <AlertCircle size={18} className="text-sky-700" />
                  <h2 className="text-body font-semibold text-sky-900">
                    새 commit {status.behind_count}개 — 업데이트 가능
                  </h2>
                </>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-caption">
              <div className="bg-bg-primary border border-border-default rounded p-3">
                <div className="text-[11px] text-text-tertiary mb-1">학교 서버 (현재)</div>
                <div className="font-mono text-body font-semibold">
                  {shortSha(status.local?.sha)}
                </div>
                {status.local?.message && (
                  <div className="text-[11px] text-text-secondary mt-1 line-clamp-2">
                    {status.local.message}
                  </div>
                )}
                <div className="text-[11px] text-text-tertiary mt-1">
                  {formatDate(status.local?.committed_at)}
                </div>
              </div>
              <div className="bg-bg-primary border border-border-default rounded p-3">
                <div className="text-[11px] text-text-tertiary mb-1">GitHub HEAD</div>
                <div className="font-mono text-body font-semibold">
                  {shortSha(status.remote?.sha)}
                </div>
                {status.remote?.message && (
                  <div className="text-[11px] text-text-secondary mt-1 line-clamp-2">
                    {status.remote.message}
                  </div>
                )}
                <div className="text-[11px] text-text-tertiary mt-1">
                  {formatDate(status.remote?.committed_at)}
                  {status.remote?.author && ` · ${status.remote.author}`}
                </div>
                {status.remote?.html_url && (
                  <a
                    href={status.remote.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline mt-1"
                  >
                    GitHub에서 보기 <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>

            {lastChecked && (
              <div className="text-[11px] text-text-tertiary mt-3">
                마지막 확인: {lastChecked}
              </div>
            )}
          </div>

          {/* 차이 commit list */}
          {status.commits.length > 0 && (
            <div className="bg-bg-primary border border-border-default rounded-lg p-5 mb-4">
              <h3 className="text-body font-semibold mb-3">
                새 commit ({status.commits.length})
              </h3>
              <ul className="space-y-2">
                {status.commits.map((c) => (
                  <li key={c.sha} className="border-l-2 border-sky-400 pl-3 py-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <a
                        href={c.html_url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-caption text-text-primary hover:text-accent line-clamp-1 flex-1"
                      >
                        {c.message}
                      </a>
                      <code className="text-[11px] text-text-tertiary font-mono">{shortSha(c.sha)}</code>
                    </div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">
                      {c.author && `${c.author} · `}{formatDate(c.committed_at)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 업데이트 절차 가이드 */}
          {status.behind_count > 0 && (
            <div className="bg-bg-primary border border-border-default rounded-lg p-5">
              <h3 className="text-body font-semibold mb-3">업데이트 적용 절차</h3>
              <p className="text-caption text-text-secondary mb-3">
                자동 git pull은 alembic 마이그레이션·테스트 미검증 코드 위험으로 끄지 않았습니다.
                서버에 SSH 접속 후 아래 순서로 실행하세요.
              </p>
              <div className="bg-bg-secondary border border-border-default rounded p-3 font-mono text-[12px] space-y-1">
                <div className="text-text-tertiary"># 1) 학교 서버 SSH 접속</div>
                <div>cd /path/to/general_school</div>
                <div className="text-text-tertiary mt-2"># 2) 최신 코드 pull</div>
                <div>git pull origin main</div>
                <div className="text-text-tertiary mt-2"># 3) 의존성 갱신 (필요 시)</div>
                <div>cd backend && pip install -r requirements.txt</div>
                <div>cd ../frontend && npm install && npm run build</div>
                <div className="text-text-tertiary mt-2"># 4) DB 마이그레이션</div>
                <div>cd ../backend && alembic upgrade head</div>
                <div className="text-text-tertiary mt-2"># 5) 서비스 재시작</div>
                <div>sudo systemctl restart gs-backend gs-frontend gs-hocuspocus</div>
                <div className="text-text-tertiary mt-2"># 6) 동작 확인</div>
                <div>sudo systemctl status gs-backend</div>
                <div>curl http://localhost:8002/api/system/health</div>
              </div>
              <p className="text-[11px] text-text-tertiary mt-3">
                💡 큰 변경(스키마 변경 등)이라면 사전에 DB 백업(`/system/backup`)을 받아두세요.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
