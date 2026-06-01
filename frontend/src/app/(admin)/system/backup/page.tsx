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
 *
 * 자동 백업 스케줄은 _components/BackupSchedule.tsx.
 */

import { useState } from "react";
import { Download, Upload, AlertTriangle, CheckCircle2, FileArchive } from "lucide-react";
import { BackupSchedule } from "./_components/BackupSchedule";

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
  const [resetText, setResetText] = useState("");
  const [resetting, setResetting] = useState(false);

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
      if (!res.ok) throw new Error(data?.detail || "미리보기 실패");
      setPreview(data);
    } catch (err: any) {
      alert("미리보기 실패: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async () => {
    if (!file) return;
    const ok = confirm(
      "⚠️ 현재 모든 데이터를 삭제하고 백업 내용으로 교체합니다.\n돌이킬 수 없습니다. 계속하시겠습니까?",
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

  const runFactoryReset = async () => {
    if (resetText !== "전체 초기화") return;
    const ok = confirm(
      "⚠️ 모든 데이터·계정(최고관리자 포함)을 삭제하고 빈 상태로 되돌립니다.\n돌이킬 수 없습니다. 계속할까요?",
    );
    if (!ok) return;
    setResetting(true);
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/system/backup/factory-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirm: "전체 초기화" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "초기화 실패");
      alert(
        "전체 초기화 완료. 모든 데이터·파일이 삭제됐습니다.\n" +
        "첫 회원가입자가 다시 최고관리자가 됩니다.\n로그인 페이지로 이동합니다.",
      );
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      window.location.href = "/auth/login";
    } catch (err: any) {
      alert("초기화 실패: " + err.message);
    } finally {
      setResetting(false);
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

      {/* Danger Zone — 전체 초기화 */}
      <div className="mt-8 border-2 border-red-500/50 rounded-lg p-5 bg-red-500/5">
        <h2 className="text-body font-bold text-red-500 flex items-center gap-2 mb-2">
          ⚠️ 위험 구역 (Danger Zone)
        </h2>
        <p className="text-caption text-text-secondary mb-1">
          <b className="text-text-primary">전체 초기화</b> — 모든 데이터·계정(최고관리자 포함)과 업로드 파일을
          삭제하고 빈 상태로 되돌립니다. 권한·메뉴 기본값만 남으며, <b className="text-text-primary">첫 회원가입자가
          다시 최고관리자</b>가 됩니다.
        </p>
        <p className="text-caption text-red-400 mb-3">
          ❗ 돌이킬 수 없습니다. 먼저 위에서 <b>전체 백업 다운로드</b>로 스냅샷을 받아두세요. (2FA 인증 필요)
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
            placeholder={'확인하려면 "전체 초기화" 입력'}
            className="px-3 py-2 rounded border border-border-default bg-bg-primary text-text-primary text-caption w-64"
          />
          <button
            onClick={runFactoryReset}
            disabled={resetText !== "전체 초기화" || resetting}
            className="px-4 py-2 rounded bg-red-600 text-white text-caption font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700"
          >
            {resetting ? "초기화 중..." : "전체 초기화 실행"}
          </button>
        </div>
      </div>
    </div>
  );
}
