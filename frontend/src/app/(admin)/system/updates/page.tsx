"use client";

/**
 * 코드 업데이트 확인 (`/system/updates`).
 * super_admin 전용. GitHub repo HEAD 비교 + 업데이트 가이드.
 *
 * 정책 (학교 자체 운영):
 *   - 자동 git pull 안 함 (alembic migration·테스트 미검증 코드 위험)
 *   - 알림만 띄우고 사용자가 수동 `git pull && systemctl restart gs-backend`
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Github, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, Loader2, Play, ShieldCheck, XCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { PermissionGate } from "@/components/common/permission-gate";

interface UpdateStep {
  name: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  returncode?: number;
  took_sec?: number;
}

interface UpdateProgress {
  exists: boolean;
  running?: boolean;
  started_at?: string;
  finished_at?: string;
  from_commit?: string;
  to_commit?: string;
  current_step?: string;
  steps?: UpdateStep[];
  dry_run?: boolean;
}

interface UpdateLast {
  exists?: boolean;
  ok?: boolean;
  error?: string;
  failed_step?: string;
  rollback?: any;
  from_commit?: string;
  to_commit?: string;
  started_at?: string;
  finished_at?: string;
  steps_count?: number;
}

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

          {/* 자동 적용 패널 (super_admin 전용) */}
          {status.behind_count > 0 && (
            <PermissionGate permission="system.updates.apply">
              <AutoUpdatePanel onAfterApply={load} />
            </PermissionGate>
          )}

          {/* 수동 업데이트 절차 가이드 (자동 안 쓰는 경우) */}
          {status.behind_count > 0 && (
            <details className="bg-bg-primary border border-border-default rounded-lg p-5">
              <summary className="cursor-pointer text-body font-semibold">수동 업데이트 절차 (SSH로)</summary>
              <p className="text-caption text-text-secondary mt-3 mb-3">
                자동 적용 대신 SSH로 직접 실행하고 싶을 때:
              </p>
              <div className="bg-bg-secondary border border-border-default rounded p-3 font-mono text-[12px] space-y-1">
                <div className="text-text-tertiary"># 1) 학교 서버 SSH 접속</div>
                <div>cd ~/general_school</div>
                <div className="text-text-tertiary mt-2"># 2) 백업 (안전)</div>
                <div>bash production/scripts/backup.sh</div>
                <div className="text-text-tertiary mt-2"># 3) pull + 빌드</div>
                <div>git pull origin main</div>
                <div>cd backend && ./venv/bin/pip install -r requirements.txt && ./venv/bin/alembic upgrade head && cd ..</div>
                <div>cd frontend && npm ci --legacy-peer-deps && npm run build && cp -r .next/static .next/standalone/.next/ && cd ..</div>
                <div>cd backend-hocuspocus && npm ci && npm run build && cd ..</div>
                <div className="text-text-tertiary mt-2"># 4) 재시작</div>
                <div>sudo systemctl restart gs-backend gs-frontend gs-hocuspocus</div>
                <div>curl http://localhost/api/health</div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}


// ── 자동 적용 패널 ──────────────────────────────────────────────────────

interface AutoUpdatePanelProps {
  onAfterApply: () => void | Promise<void>;
}

const STEP_LABELS: Record<string, string> = {
  init: "초기화",
  preflight: "0. 충돌 검출 (학교 로컬 변경/위험 마이그레이션)",
  backup: "1. 백업 (DB + storage)",
  from_commit: "2. 현재 commit 저장",
  dry_run_done: "✅ Dry-run 완료",
  git_pull: "3. git pull (+ stash pop)",
  to_commit: "git rev-parse HEAD",
  pip_install: "4. pip 의존성 갱신",
  alembic: "5. DB 마이그레이션 (alembic upgrade head)",
  npm_install: "6. npm ci",
  npm_build: "7. frontend build",
  hocuspocus: "8. hocuspocus build",
  restart: "9. systemctl restart",
  health: "10. health check (/api/health)",
  rollback_git: "🔄 Rollback: git reset",
  rollback_stash_pop: "🔄 Rollback: stash 복원",
  rollback_db: "🔄 Rollback: DB 복원",
  rollback_restart: "🔄 Rollback: 재시작",
};

interface PreflightResult {
  blocked: boolean;
  reasons: string[];
  local_dirty: boolean;
  local_commits: string[];
  risky_changes: { file: string; kind: string }[];
}

function AutoUpdatePanel({ onAfterApply }: AutoUpdatePanelProps) {
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [last, setLast] = useState<UpdateLast | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<null | "real" | "dry">(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [forceLocal, setForceLocal] = useState(false);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const pollRef = useRef<any>(null);

  const fetchProgress = useCallback(async () => {
    try {
      const r = await api.get<UpdateProgress>("/api/system/updates/progress");
      setProgress(r);
      if (!r.running) {
        const l = await api.get<UpdateLast>("/api/system/updates/last");
        setLast(l);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        await onAfterApply();
      }
    } catch (e: any) {
      // 서비스 재시작 중일 가능성 — 무시
      setPollErr(e?.detail || "");
    }
  }, [onAfterApply]);

  const runPreflight = useCallback(async () => {
    try {
      const r = await api.get<PreflightResult>("/api/system/updates/preflight");
      setPreflight(r);
    } catch (e: any) {
      setPreflight({
        blocked: true,
        reasons: ["preflight 호출 실패: " + (e?.message || "")],
        local_dirty: false, local_commits: [], risky_changes: [],
      });
    }
  }, []);

  useEffect(() => {
    fetchProgress();
    runPreflight();
  }, [fetchProgress, runPreflight]);

  const start = async (dryRun: boolean) => {
    setConfirmOpen(null);
    setBusy(true);
    setPollErr(null);
    try {
      const params = new URLSearchParams({
        dry_run: String(dryRun),
        force_local_override: String(forceLocal),
        allow_data_destructive: String(allowDestructive),
      });
      await api.post(`/api/system/updates/apply?${params}`, {});
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchProgress, 2000);
      await fetchProgress();
    } catch (e: any) {
      alert(e?.detail || e?.message || "시작 실패");
    } finally {
      setBusy(false);
    }
  };

  const running = progress?.running;
  const steps = progress?.steps || [];

  return (
    <div className="bg-bg-primary border border-accent rounded-lg p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-accent" />
          <h3 className="text-body font-semibold">자동 업데이트 적용</h3>
        </div>
      </div>

      <p className="text-caption text-text-secondary mb-3">
        한 번 클릭으로 <b>preflight → 백업 → git pull → 의존성 → DB 마이그레이션 → 빌드 → 재시작 → health check</b> 자동 진행.
        실패 시 자동 rollback (git reset + stash 복원 + DB 복원 + 재시작) — <b>데이터 손실 없음 보장</b>.
        재시작 시 1~5초 다운타임 (Yjs/세션 자동 재연결).
      </p>

      {/* preflight 결과 */}
      {!running && preflight && (preflight.local_dirty || preflight.local_commits.length > 0 || preflight.risky_changes.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-3 text-[12px]">
          <div className="flex items-center gap-1 mb-2 font-semibold text-amber-900">
            <AlertCircle size={12} /> 충돌 또는 위험 변경 감지
          </div>
          {preflight.local_dirty && (
            <div className="text-amber-800">⚠️ 학교 로컬 미커밋 변경 있음 (git status로 확인)</div>
          )}
          {preflight.local_commits.length > 0 && (
            <div className="text-amber-800">
              ⚠️ 학교 로컬 commit {preflight.local_commits.length}개 (GitHub에 없음):
              <ul className="ml-4 mt-1 list-disc">
                {preflight.local_commits.slice(0, 5).map((c, i) => (
                  <li key={i} className="font-mono text-[11px]">{c}</li>
                ))}
              </ul>
            </div>
          )}
          {preflight.risky_changes.length > 0 && (
            <div className="text-amber-800 mt-2">
              ⚠️ 새 commit에 위험 마이그레이션 ({preflight.risky_changes.length}개):
              <ul className="ml-4 mt-1 list-disc">
                {preflight.risky_changes.map((r, i) => (
                  <li key={i} className="font-mono text-[11px]">
                    [{r.kind}] {r.file}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 space-y-1">
            {(preflight.local_dirty || preflight.local_commits.length > 0) && (
              <label className="flex items-start gap-2 text-amber-900">
                <input type="checkbox" checked={forceLocal} onChange={(e) => setForceLocal(e.target.checked)} className="mt-1" />
                <span>학교 로컬 변경을 stash 후 강행 (성공 시 다시 적용 시도, conflict 시 자동 rollback)</span>
              </label>
            )}
            {preflight.risky_changes.length > 0 && (
              <label className="flex items-start gap-2 text-amber-900">
                <input type="checkbox" checked={allowDestructive} onChange={(e) => setAllowDestructive(e.target.checked)} className="mt-1" />
                <span>위험 마이그레이션 허용 (drop_column 등 — 백업으로 복원 가능)</span>
              </label>
            )}
          </div>
        </div>
      )}

      {!running && (
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setConfirmOpen("real")}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 text-body bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 font-semibold"
          >
            <Play size={14} /> 지금 업데이트 적용
          </button>
          <button
            onClick={() => setConfirmOpen("dry")}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-2 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
          >
            Dry-run (백업만)
          </button>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-bg-primary rounded-lg p-6 max-w-md w-full">
            <h4 className="text-title mb-3">
              {confirmOpen === "dry" ? "Dry-run 진행?" : "업데이트 적용 진행?"}
            </h4>
            <p className="text-caption text-text-secondary mb-4">
              {confirmOpen === "dry"
                ? "백업까지만 진행하고 실제 변경은 하지 않습니다. 안전 테스트용."
                : "백업 → 업데이트 → 검증 → (실패 시) 자동 rollback. 약 5~15분 소요. 그동안 1~5초 다운타임 가능."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(null)}
                className="px-4 py-2 text-body border border-border-default rounded hover:bg-bg-secondary"
              >
                취소
              </button>
              <button
                onClick={() => start(confirmOpen === "dry")}
                className="px-4 py-2 text-body bg-accent text-white rounded hover:bg-accent-hover"
              >
                진행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 진행 중 상태 */}
      {running && (
        <div className="bg-sky-50 border border-sky-200 rounded p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="animate-spin text-sky-700" />
            <span className="text-caption font-semibold text-sky-900">
              진행 중 — 현재 단계: {STEP_LABELS[progress?.current_step || ""] || progress?.current_step}
            </span>
          </div>
          <div className="space-y-1 mt-2 text-[12px]">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                {s.ok ? <CheckCircle2 size={12} className="text-emerald-600" /> : <XCircle size={12} className="text-red-600" />}
                <span className="font-mono text-[11px]">{STEP_LABELS[s.name] || s.name}</span>
                {s.took_sec !== undefined && <span className="text-text-tertiary text-[10px]">({s.took_sec}s)</span>}
              </div>
            ))}
          </div>
          {pollErr && (
            <div className="text-[11px] text-text-tertiary mt-2">
              polling 일시 끊김 — 서비스 재시작 중일 수 있음 (자동 복구)
            </div>
          )}
        </div>
      )}

      {/* 마지막 결과 */}
      {!running && last && last.exists !== false && (
        <div className={`rounded p-3 ${last.ok ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
          <div className="flex items-center gap-2 mb-2">
            {last.ok ? (
              <>
                <CheckCircle2 size={14} className="text-emerald-700" />
                <span className="text-caption font-semibold text-emerald-900">마지막 업데이트 성공</span>
              </>
            ) : (
              <>
                <XCircle size={14} className="text-red-700" />
                <span className="text-caption font-semibold text-red-900">마지막 업데이트 실패 — Rollback 완료</span>
              </>
            )}
          </div>
          {last.from_commit && (
            <div className="text-[11px] text-text-secondary font-mono">
              {last.from_commit.slice(0, 7)} → {last.to_commit?.slice(0, 7) || "rollback"}
            </div>
          )}
          {last.error && (
            <div className="text-[11px] text-red-700 mt-2">
              <b>실패 단계:</b> {last.failed_step} — {last.error}
            </div>
          )}
          {last.finished_at && (
            <div className="text-[11px] text-text-tertiary mt-1">
              완료 시각: {new Date(last.finished_at).toLocaleString("ko-KR")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
