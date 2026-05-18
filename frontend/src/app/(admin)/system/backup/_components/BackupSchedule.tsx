"use client";

/**
 * 자동 백업 스케줄 — backend가 떠 있는 동안 주기적으로 자동 백업.
 *
 * - 활성화 / 주기 (시간) / 보관 개수 / 저장 경로 설정
 * - 지금 1회 실행 (수동 트리거)
 * - 저장된 백업 파일 목록 + 다운로드/삭제
 */

import { useCallback, useEffect, useState } from "react";
import {
  Clock, Download, FileArchive, PlayCircle,
  RefreshCw, Save, Trash2,
} from "lucide-react";
import { api } from "@/lib/api/client";


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


export function BackupSchedule() {
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
