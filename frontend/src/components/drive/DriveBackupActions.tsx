"use client";

/**
 * DrivePage 상단 백업/복원/Google export 3개 버튼.
 *
 * - 백업 ZIP: 본인 드라이브 전체 ZIP 다운로드 (학교 이동 시)
 * - 복원: 다른 학교 백업 ZIP 업로드 → 새 자료로 추가
 * - Google 백업: 본인 문서·시트를 Google Drive로 일괄 업로드 (변환 지원 한정)
 *
 * trashMode일 때는 자체 렌더 안 함 (휴지통 화면에선 백업 의미 없음).
 */

import { Download, Upload, Globe } from "lucide-react";
import { api } from "@/lib/api/client";

interface Toast {
  show: (msg: string, kind?: "info" | "success" | "error") => void;
}

export function DriveBackupActions({
  trashMode,
  toast,
  fetchAll,
}: {
  trashMode: boolean;
  toast: Toast;
  fetchAll: () => Promise<void> | void;
}) {
  if (trashMode) return null;

  const handleBackupDownload = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
      const tokenKey = localStorage.getItem("access_token");
      toast.show("백업 만드는 중... (자료 많으면 수십 초)", "info");
      const res = await fetch(`${API_URL}/api/drive/backup/download`, {
        method: "POST",
        headers: tokenKey ? { Authorization: `Bearer ${tokenKey}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      a.download = `drive-backup-${today}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.show("백업 다운로드 완료", "success");
    } catch (e: any) {
      alert(e?.message || "백업 실패");
    }
  };

  const handleRestoreFile = async (f: File) => {
    if (!confirm(
      `"${f.name}" 백업을 내 드라이브에 복원합니다.\n` +
      `기존 자료는 그대로 유지됩니다 (새 자료로 추가).\n` +
      `진행하시겠습니까?`
    )) return;
    try {
      toast.show("복원 중... (자료 많으면 수십 초)", "info");
      const r = await api.upload<{
        imported: { folders: number; docs: number; sheets: number; decks: number; surveys: number; hwps: number };
        consumed_bytes: number;
        note: string;
      }>("/api/drive/backup/import", f);
      const i = r.imported;
      alert(
        `복원 완료\n\n` +
        `폴더: ${i.folders}\n` +
        `문서: ${i.docs}\n` +
        `시트: ${i.sheets}\n` +
        `프리젠테이션: ${i.decks}\n` +
        `설문지: ${i.surveys}\n` +
        `HWP: ${i.hwps}\n\n` +
        `${r.note}`
      );
      fetchAll();
    } catch (err: any) {
      alert(err?.detail || err?.message || "복원 실패");
    }
  };

  const handleGoogleBulk = async () => {
    if (!confirm("본인 문서·스프레드시트를 Google Drive로 일괄 업로드합니다.\n(프리젠테이션·설문지·한컴은 미지원 — ZIP 백업 권장)\n진행하시겠습니까?")) return;
    try {
      toast.show("Google Drive로 업로드 중... (자료 많으면 시간 걸림)", "info");
      const r = await api.post<{ ok: number; failed: number; total: number }>(
        "/api/google/export/my-drive-bulk", {},
      );
      toast.show(
        `Google Drive 백업 완료 — ${r.ok}/${r.total} 성공${r.failed ? `, ${r.failed} 실패` : ""}`,
        r.failed > 0 ? "error" : "success",
      );
    } catch (e: any) {
      const msg = e?.detail || e?.message || "";
      if (msg.includes("토큰") || msg.includes("Google") || e?.status === 400) {
        alert(
          "Google 계정이 연결되지 않았습니다.\n" +
          "/system/integrations/google 페이지에서 먼저 Google 계정을 연결하세요.\n\n" +
          `(${msg || "연결 필요"})`
        );
      } else {
        alert(msg || "Google Drive 백업 실패");
      }
    }
  };

  return (
    <>
      {/* 백업 다운로드 — 학교 이동 시 */}
      <button
        type="button"
        onClick={handleBackupDownload}
        className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-text-secondary border border-border-default hover:bg-bg-secondary"
        title="내 드라이브 전체 ZIP 다운로드 (학교 이동 시)"
      >
        <Download size={13} /> 백업 ZIP
      </button>
      {/* 복원 (ZIP 업로드) */}
      <input
        type="file"
        accept=".zip,application/zip"
        style={{ display: "none" }}
        id="drive-restore-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          e.target.value = ""; // reset
          await handleRestoreFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => document.getElementById("drive-restore-input")?.click()}
        className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-text-secondary border border-border-default hover:bg-bg-secondary"
        title="다른 학교에서 가져온 백업 ZIP을 복원"
      >
        <Upload size={13} /> 복원
      </button>
      {/* Google Drive 일괄 export */}
      <button
        type="button"
        onClick={handleGoogleBulk}
        className="px-3 py-2 text-[12px] rounded-md flex items-center gap-1.5 text-text-secondary border border-border-default hover:bg-bg-secondary"
        title="문서·시트를 본인 Google Drive로 일괄 업로드"
      >
        <Globe size={13} /> Google 백업
      </button>
    </>
  );
}
