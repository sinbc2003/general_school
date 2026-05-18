"use client";

/**
 * 학기 명단 CSV 일괄 등록 모달.
 *
 * 공통 CsvUploader 컴포넌트 + role 선택만 추가.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { CsvUploader, type CsvUploadResult } from "@/components/ui/CsvUploader";
import { Upload } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface Props {
  open: boolean;
  semesterId: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

const downloadTemplate = async (role: "teacher" | "student") => {
  try {
    const token = localStorage.getItem("access_token");
    const res = await fetch(`${API_URL}/api/timetable/enrollments/csv-template/${role}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("template download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${role}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    alert("템플릿 다운로드 실패: " + (err?.message || ""));
  }
};

export function CsvUploadModal({ open, semesterId, onClose, onSuccess }: Props) {
  const [uploadRole, setUploadRole] = useState<"teacher" | "student">("teacher");

  const uploadCsv = async (file: File, dryRun: boolean): Promise<CsvUploadResult> => {
    if (!semesterId) throw new Error("학기를 먼저 선택하세요");
    const token = localStorage.getItem("access_token");
    const fd = new FormData();
    fd.append("file", file);
    const url = `${API_URL}/api/timetable/semesters/${semesterId}/import-enrollments?role=${uploadRole}&dry_run=${dryRun ? "true" : "false"}`;
    const res = await fetch(url, {
      method: "POST",
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "업로드 실패");
    return data;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="CSV 일괄 등록"
      icon={<Upload size={18} />}
      maxWidth="xl"
    >
      <div className="flex items-center gap-2 mb-3">
        <label className="text-caption text-text-secondary">대상:</label>
        <select
          value={uploadRole}
          onChange={(e) => setUploadRole(e.target.value as "teacher" | "student")}
          className="px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
        >
          <option value="teacher">교직원 (부서, 이름, 핸드폰)</option>
          <option value="student">학생 (학번, 이름, 핸드폰)</option>
        </select>
      </div>
      <CsvUploader
        key={uploadRole /* role 바뀌면 상태 초기화 */}
        onUpload={uploadCsv}
        onTemplateDownload={() => downloadTemplate(uploadRole)}
        onSuccess={onSuccess}
        description={
          <>
            <div>• <b>이름</b>이 자동으로 <b>아이디</b>가 됩니다 (동명이인은 <code>홍길동_2</code> 자동 부여).</div>
            <div>• <b>초기 비밀번호 = 휴대폰 번호</b> (숫자만, &apos;-&apos; 제거)</div>
            <div>• 첫 로그인 시 비밀번호 변경이 강제됩니다.</div>
            <div>• 이메일은 자동 생성됩니다 (<code>이름@school.local</code>).</div>
          </>
        }
        renderExtraMetrics={(r) => (
          <>
            {" · "}신규 사용자 <b>{r.created_users}</b>
            {" · "}기존 사용자 재사용 <b>{r.reused_users}</b>
            {r.enrolled !== undefined && (
              <>
                {" · "}명단 등록 <b>{r.enrolled}</b>
              </>
            )}
          </>
        )}
      />
    </Modal>
  );
}
