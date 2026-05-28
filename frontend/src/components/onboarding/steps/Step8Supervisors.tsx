"use client";

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Download, Upload, AlertCircle, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface Semester { id: number; name: string; is_current: boolean }

export function Step8Supervisors() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<any>(null);
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/api/timetable/semesters").then((d) => {
      const arr = Array.isArray(d) ? d : d.items || [];
      setSemesters(arr);
      const cur = arr.find((s: Semester) => s.is_current) || arr[0];
      if (cur) setSemesterId(cur.id);
    });
  }, []);

  const downloadTemplate = async () => {
    const token = localStorage.getItem("access_token");
    const res = await fetch(`${API_URL}/api/past-research/_supervisions/_csv-template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { alert(`템플릿 다운로드 실패: ${res.status}`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "research_supervisions_template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const upload = async (dry: boolean) => {
    if (!file || !semesterId) { alert("학기·파일 선택"); return; }
    setWorking(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("semester_id", String(semesterId));
      fd.append("dry_run", String(dry));
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/past-research/_supervisions/_bulk-import`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      if (dry) {
        setDryRun(data);
      } else {
        alert(`완료: 신규 ${data.added}건 / 변경 ${data.updated}건 / 실패 ${data.failed.length}건`);
        setDryRun(null);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    } catch (e: any) {
      alert(`실패: ${e.message || e}`);
    } finally { setWorking(false); }
  };

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-body font-semibold text-text-primary mb-1">연구 담당교사 매핑</h3>
        <p className="text-caption text-text-tertiary">
          학생이 본인 연구 보고서를 누구에게 제출할지 1:1로 지정합니다. 학기 단위.
        </p>
        <p className="text-caption text-text-tertiary mt-1">
          <span className="text-amber-600 inline-flex items-center gap-1"><AlertCircle size={11} /></span>
          나중에도 <span className="text-text-primary font-medium">관리 → 연구 담당교사 매핑</span> 페이지에서 추가/수정 가능합니다.
        </p>
      </div>

      <div className="mb-3 p-3 bg-bg-secondary rounded">
        <h4 className="text-caption font-semibold mb-2">방법 1: CSV 일괄 등록</h4>
        <ol className="text-caption text-text-secondary list-decimal list-inside space-y-1 mb-2">
          <li><button onClick={downloadTemplate} className="text-accent inline-flex items-center gap-1 hover:underline"><Download size={11} /> 템플릿 다운로드</button> → Excel/스프레드시트 편집</li>
          <li>컬럼 3개: <code className="px-1 bg-bg-primary rounded text-[11px]">student_username, supervisor_username, topic_title</code></li>
          <li>업로드 후 "검증" → "실제 등록"</li>
        </ol>

        <label className="block mb-2">
          <span className="text-caption text-text-tertiary">학기</span>
          <select value={semesterId} onChange={(e) => setSemesterId(parseInt(e.target.value))}
                  className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
            {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " (현재)" : ""}</option>)}
          </select>
        </label>

        <input
          ref={inputRef} type="file" accept=".csv"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setDryRun(null); }}
          className="mb-2 w-full text-caption"
        />

        {dryRun && (
          <div className="mb-2 p-2 bg-bg-primary border border-border-default rounded">
            <div className="text-caption font-semibold mb-1">검증 결과</div>
            <div className="grid grid-cols-3 gap-1 text-caption">
              <div className="text-green-700">신규 {dryRun.added}</div>
              <div className="text-blue-700">변경 {dryRun.updated}</div>
              <div className="text-red-700">실패 {dryRun.failed.length}</div>
            </div>
            {dryRun.failed.length > 0 && (
              <details className="mt-1 text-caption">
                <summary className="cursor-pointer text-red-600">실패 행 ({dryRun.failed.length})</summary>
                <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                  {dryRun.failed.map((f: any, i: number) => (
                    <div key={i} className="text-[11px]">행 {f.row}: {f.reason}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={() => upload(true)} disabled={working || !file}
                  className="px-3 py-1 border border-border-default text-caption rounded disabled:opacity-50">
            {working && !dryRun ? "검증 중..." : "검증"}
          </button>
          <button onClick={() => upload(false)} disabled={working || !file}
                  className="px-3 py-1 bg-accent text-white text-caption rounded disabled:opacity-50">
            {working ? "등록 중..." : "실제 등록"}
          </button>
        </div>
      </div>

      <div className="p-3 bg-bg-secondary rounded">
        <h4 className="text-caption font-semibold mb-2">방법 2: 개별 등록 / 교사 본인 등록</h4>
        <p className="text-caption text-text-secondary mb-2">
          CSV 없이도 가능 — 관리자가 학생별로 1건씩 지정하거나, 각 교사가 직접 본인 담당 학생을 등록할 수 있습니다.
        </p>
        <a href="/system/research-supervisors" target="_blank"
           className="inline-flex items-center gap-1 text-caption text-accent hover:underline">
          관리자 매핑 페이지 열기 <ExternalLink size={11} />
        </a>
      </div>

      <p className="mt-3 text-caption text-text-tertiary text-center">
        이 단계는 건너뛰어도 OK — 나중에 언제든 추가할 수 있습니다.
      </p>
    </div>
  );
}
