"use client";

/**
 * 전체 백업/복원 페이지 (super_admin 전용).
 *
 * 시나리오: 임시 장비 → 새 장비 이관
 *   1. 임시 장비에서 ZIP 다운로드
 *   2. 새 장비에 SETUP.md 따라 설치 (DB는 빈 상태로 시작)
 *   3. super_admin 가입 (또는 임시 super_admin 가입)
 *   4. 이 페이지에서 ZIP 업로드 → 미리보기 검증 → 실제 복원
 *   5. (호환성 경고가 있으면) alembic upgrade head + 재시작
 *
 * 미래 기능 추가에도 일관: SQLAlchemy 메타데이터 기반 동적 export라
 * 새 테이블/컬럼이 생겨도 백업에 자동 포함됨.
 */

import { useState, useEffect, useCallback } from "react";
import { Download, Upload, AlertTriangle, CheckCircle2, FileArchive, Clock, PlayCircle, Save, Trash2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface RestoreResult {
  manifest: {
    format_version: number;
    exported_at: string;
    alembic_revision: string | null;
    table_count: number;
    row_counts: Record<string, number>;
    total_rows: number;
  };
  compatible: boolean;
  warnings: string[];
  applied: boolean;
  row_counts: Record<string, number>;
}

export default function BackupPage() {
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestoreResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<RestoreResult | null>(null);

  const downloadBackup = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/system/backup/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : `school_backup_${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("백업 다운로드 실패: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const runPreview = async () => {
    if (!file) return;
    setBusy(true);
    setApplied(null);
    try {
      const token = localStorage.getItem("access_token");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/api/system/backup/restore/preview`, {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "검증 실패");
      setPreview(data);
    } catch (err: any) {
      alert("검증 실패: " + err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async () => {
    if (!file || !preview) return;
    const ok = confirm(
      "⚠️ 현재 모든 데이터가 백업으로 교체됩니다. 돌이킬 수 없습니다.\n" +
      "정말 복원하시겠습니까?",
    );
    if (!ok) return;
    const ok2 = confirm("정말로 진행합니다. 한 번 더 확인하세요.");
    if (!ok2) return;
    setBusy(true);
    try {
      const token = localStorage.getItem("access_token");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/api/system/backup/restore`, {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "복원 실패");
      setApplied(data);
      // 사용자 데이터가 바뀌었으니 token이 무효일 수 있음 → 로그아웃 안내
      alert(
        "복원 완료. 호환성 경고가 있으면 백엔드 서버에서:\n" +
        "  cd backend && source venv/bin/activate && alembic upgrade head\n" +
        "을 실행하고 재시작하세요.\n\n" +
        "30초 후 자동 로그아웃됩니다 (보안).",
      );
      setTimeout(() => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.location.href = "/auth/login";
      }, 30000);
    } catch (err: any) {
      alert("복원 실패: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title text-text-primary flex items-center gap-2">
          <FileArchive size={22} /> 전체 백업·복원
        </h1>
        <p className="text-caption text-text-tertiary mt-1">
          DB 모든 테이블 (자동) + 사용자 업로드 파일 (storage/) 통째로 ZIP. 새 장비로 이관 또는 재해 복구.
        </p>
      </div>

      {/* 자동 백업 스케줄 */}
      <BackupSchedule />

      {/* 백업 다운로드 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-6 mb-6">
        <h2 className="text-body font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Download size={16} /> 백업 다운로드 (수동)
        </h2>
        <p className="text-caption text-text-secondary mb-4">
          현재 학교의 모든 데이터를 단일 ZIP 파일로 받습니다. 안전한 외장 SSD나 클라우드에 보관 권장.
        </p>
        <ul className="text-caption text-text-tertiary mb-4 space-y-0.5 list-disc list-inside">
          <li>모든 테이블 (학생/교사/명단/대회/과제/포트폴리오 등) — JSON</li>
          <li>storage/ 디렉터리 (학생 산출물·과제 제출물·로고) — tar.gz</li>
          <li>manifest (날짜·alembic 버전·테이블 행수)</li>
          <li><b>새 테이블이 추가되어도 자동 포함</b> (SQLAlchemy 메타데이터 기반)</li>
        </ul>
        <button
          onClick={downloadBackup}
          disabled={downloading}
          className="flex items-center gap-1 px-4 py-2 text-body bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Download size={14} />
          {downloading ? "백업 생성 중..." : "전체 백업 다운로드"}
        </button>
      </div>

      {/* 복원 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-6 mb-6">
        <h2 className="text-body font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Upload size={16} /> 백업 복원
        </h2>
        <div className="p-3 bg-red-50 border border-red-200 rounded mb-4 text-caption text-red-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            <b>주의:</b> 복원은 <b>현재 모든 데이터를 삭제</b>하고 백업으로 교체합니다. 돌이킬 수 없습니다.
            먼저 "미리보기"로 manifest와 호환성을 확인한 후 진행하세요.
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-caption text-text-secondary mb-1">
              백업 ZIP 파일 *
            </label>
            <input
              type="file"
              accept=".zip"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setApplied(null);
              }}
              className="w-full text-body"
            />
            {file && (
              <div className="text-caption text-text-tertiary mt-1">
                선택: {file.name} ({Math.round(file.size / 1024)} KB)
              </div>
            )}
          </div>

          {preview && (
            <div className="p-3 border border-border-default rounded bg-bg-secondary text-caption">
              <div className="text-text-primary font-medium mb-2">📋 백업 정보</div>
              <div className="grid grid-cols-2 gap-2 text-text-secondary">
                <div>내보낸 시각: {preview.manifest.exported_at}</div>
                <div>alembic: {preview.manifest.alembic_revision || "없음"}</div>
                <div>테이블 수: {preview.manifest.table_count}</div>
                <div>총 행 수: {preview.manifest.total_rows}</div>
              </div>
              {preview.warnings.length > 0 && (
                <div className="mt-3 text-amber-700">
                  <div className="font-medium mb-1">⚠️ 호환성 경고:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {applied && (
            <div className="p-3 border border-emerald-200 rounded bg-emerald-50 text-caption">
              <div className="text-emerald-800 font-medium flex items-center gap-1 mb-1">
                <CheckCircle2 size={14} /> 복원 완료
              </div>
              <div className="text-text-secondary">
                총 {Object.values(applied.row_counts).reduce((a, b) => a + b, 0)}건 INSERT.
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={runPreview}
              disabled={busy || !file}
              className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
            >
              {busy && !applied ? "검증 중..." : "미리보기 (검증만)"}
            </button>
            <button
              onClick={runRestore}
              disabled={busy || !file || !preview}
              className="px-4 py-1.5 text-caption bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              title={!preview ? "먼저 미리보기 실행" : ""}
            >
              {busy ? "복원 중..." : "⚠️ 실제 복원 (모든 데이터 교체)"}
            </button>
          </div>
        </div>
      </div>

      {/* 운영 가이드 */}
      <div className="bg-bg-secondary border border-border-default rounded-lg p-4 text-caption text-text-secondary">
        <div className="font-medium text-text-primary mb-2">📘 새 장비로 이관 절차</div>
        <ol className="list-decimal list-inside space-y-1">
          <li>이 페이지에서 <b>전체 백업 다운로드</b> (현재 장비)</li>
          <li>새 장비에 SETUP.md 따라 빈 상태로 설치 + 첫 super_admin 가입</li>
          <li>새 장비의 이 페이지에서 ZIP 업로드 → 미리보기 → 복원</li>
          <li>호환성 경고가 있으면 새 장비에서 <code>alembic upgrade head</code> + 재시작</li>
          <li>로그인 후 데이터·UI 확인</li>
        </ol>
      </div>
    </div>
  );
}


// ── 자동 백업 스케줄 ──────────────────────────────────────────────

interface ScheduleConfig {
  enabled: boolean;
  interval_hours: number;
  retention_count: number;
  output_dir: string;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_size_bytes: number | null;
  last_filename: string | null;
}

interface BackupFile {
  filename: string;
  size_bytes: number;
  modified_at: string;
  path: string;
}

function BackupSchedule() {
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [edits, setEdits] = useState<Partial<ScheduleConfig>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, fs] = await Promise.all([
        api.get<ScheduleConfig>("/api/system/backup/schedule"),
        api.get<{ items: BackupFile[] }>("/api/system/backup/schedule/files"),
      ]);
      setConfig(c);
      setFiles(fs.items);
      setEdits({});
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const update = <K extends keyof ScheduleConfig>(k: K, v: ScheduleConfig[K]) => {
    setEdits((p) => ({ ...p, [k]: v }));
  };

  const merged: ScheduleConfig | null = config
    ? { ...config, ...edits }
    : null;
  const dirty = Object.keys(edits).length > 0;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const patch: any = {};
      for (const k of Object.keys(edits)) {
        patch[k] = (edits as any)[k];
      }
      const result = await api.put<ScheduleConfig>("/api/system/backup/schedule", patch);
      setConfig(result);
      setEdits({});
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!confirm("자동 백업을 지금 한 번 실행합니다. 잠시 시간이 걸릴 수 있습니다. 계속하시겠습니까?")) return;
    setRunning(true);
    try {
      await api.post("/api/system/backup/schedule/run-now");
      await refresh();
    } catch (err: any) {
      alert(err?.detail || "실행 실패");
    } finally {
      setRunning(false);
    }
  };

  const removeFile = async (filename: string) => {
    if (!confirm(`'${filename}' 백업 파일을 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/system/backup/schedule/files/${filename}`);
      refresh();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const downloadFile = async (filename: string) => {
    try {
      const token = localStorage.getItem("access_token");
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";
      const res = await fetch(
        `${API_URL}/api/system/backup/schedule/files/${encodeURIComponent(filename)}/download`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("다운로드 실패: " + err.message);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  if (loading || !merged) {
    return (
      <div className="bg-bg-primary border border-border-default rounded-lg p-6 mb-6 text-text-tertiary">
        로딩 중...
      </div>
    );
  }

  const statusBadge = config?.last_status;
  const statusColor =
    statusBadge === "success" ? "text-accent" :
    statusBadge === "error" ? "text-status-error" :
    "text-text-tertiary";

  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-body font-semibold text-text-primary flex items-center gap-2">
          <Clock size={16} /> 자동 백업 스케줄
        </h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 hover:bg-bg-secondary rounded text-text-tertiary"
          title="새로고침"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <p className="text-caption text-text-secondary mb-4">
        backend가 떠 있는 동안 주기적으로 자동 백업합니다. <b>output_dir</b>을 외장 SSD 또는
        네트워크 드라이브 경로로 지정하면 별도 PC에 데이터 보존.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={merged.enabled}
              onChange={(e) => update("enabled", e.target.checked)}
              className="rounded"
            />
            <span className="text-body text-text-primary">자동 백업 활성화</span>
          </label>
        </div>

        <div>
          <label className="block text-caption text-text-secondary mb-1">
            주기 (시간) — 1~720
          </label>
          <input
            type="number"
            min={1}
            max={720}
            value={merged.interval_hours}
            onChange={(e) => update("interval_hours", parseInt(e.target.value) || 24)}
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          />
          <div className="text-caption text-text-tertiary mt-0.5">
            예: 24 = 매일 1회 · 168 = 매주 · 1 = 매시간
          </div>
        </div>

        <div>
          <label className="block text-caption text-text-secondary mb-1">
            보관 개수 — 1~365 (초과 시 오래된 것부터 삭제)
          </label>
          <input
            type="number"
            min={1}
            max={365}
            value={merged.retention_count}
            onChange={(e) => update("retention_count", parseInt(e.target.value) || 7)}
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
          />
        </div>

        <div>
          <label className="block text-caption text-text-secondary mb-1">저장 경로</label>
          <input
            type="text"
            value={merged.output_dir}
            onChange={(e) => update("output_dir", e.target.value)}
            placeholder="backend/storage/auto-backups"
            className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary font-mono text-caption"
          />
          <div className="text-caption text-text-tertiary mt-0.5">
            기본: backend/storage/auto-backups · 외장 SSD: /mnt/external/backups 등
          </div>
        </div>
      </div>

      {/* 마지막 실행 상태 */}
      {config?.last_run_at && (
        <div className="mb-4 p-3 bg-bg-secondary border border-border-default rounded text-caption">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <span className="text-text-secondary">마지막 실행:</span>{" "}
              <b className="text-text-primary">
                {config.last_run_at.slice(0, 16).replace("T", " ")}
              </b>
              {" · "}
              <span className={statusColor}>
                {statusBadge === "success" ? "성공" : statusBadge === "error" ? "실패" : statusBadge || ""}
              </span>
            </div>
            {config.last_filename && config.last_size_bytes && (
              <div className="text-text-tertiary">
                {config.last_filename} · {formatSize(config.last_size_bytes)}
              </div>
            )}
          </div>
          {config.last_error && (
            <div className="mt-2 text-status-error text-caption">
              ⚠ {config.last_error}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          onClick={runNow}
          disabled={running}
          className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
        >
          <PlayCircle size={14} />
          {running ? "실행 중..." : "지금 1회 실행"}
        </button>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? "저장 중..." : "설정 저장"}
        </button>
      </div>

      {/* 저장된 파일 목록 */}
      <div>
        <div className="text-caption font-semibold text-text-secondary mb-2">
          저장된 백업 ({files.length}개)
        </div>
        {files.length === 0 ? (
          <div className="text-caption text-text-tertiary py-3 text-center">
            아직 저장된 백업 파일이 없습니다.
          </div>
        ) : (
          <div className="border border-border-default rounded divide-y divide-border-default max-h-72 overflow-y-auto">
            {files.map((f) => (
              <div key={f.filename} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-secondary">
                <FileArchive size={14} className="text-text-tertiary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-body text-text-primary truncate font-mono">{f.filename}</div>
                  <div className="text-caption text-text-tertiary">
                    {f.modified_at.slice(0, 16).replace("T", " ")} · {formatSize(f.size_bytes)}
                  </div>
                </div>
                <button
                  onClick={() => downloadFile(f.filename)}
                  title="다운로드"
                  className="p-1.5 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent"
                >
                  <Download size={13} />
                </button>
                <button
                  onClick={() => removeFile(f.filename)}
                  title="삭제"
                  className="p-1.5 hover:bg-bg-primary rounded text-text-tertiary hover:text-status-error"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
