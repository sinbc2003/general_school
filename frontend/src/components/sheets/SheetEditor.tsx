"use client";

/**
 * Univer 기반 협업 스프레드시트 편집기 — 동적 import로 코드 분할.
 *
 * **번들 최적화**: Univer SDK는 약 1.5MB — 스프레드시트 페이지 열 때만 로드.
 * 학생/일반 페이지 진입 시 영향 0KB (Next.js webpack chunks 자동 분리).
 *
 * 협업 전략 (현재 phase):
 *  - 단일 사용자가 시트 편집 → 5초 디바운스 auto-save
 *  - 다른 사용자가 시트 열면: 마지막 저장 시점 데이터 로드 (실시간 동기화 X)
 *  - 공유는 SheetMember/access_mode로 (Google Sheets처럼 권한별 접근)
 *
 * 실시간 협업(여러 사용자 동시 편집):
 *  Univer OSS는 collaboration plugin이 별도(Pro). 본 환경에선 마지막 저장
 *  데이터 동기화로 충분 (수업 자료 분석 시나리오는 sequential 편집 패턴).
 *  추후 Yjs ↔ Univer CommandService 브릿지 직접 구현 가능.
 *
 * 보안:
 *  - GET/PUT/POST 모두 backend 권한 가드 통과 必
 *  - 시트 owner_id != user면 read-only (Univer permission 모드 적용 — Phase 2)
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";

interface SheetEditorProps {
  sheetId: number;
  canWrite: boolean;
  /** 초기 데이터 — 설문 등 외부 데이터 주입용. 비우면 빈 시트.
   *  형식: { headers: ["A", "B"], rows: [[1, 2], [3, 4]] } */
  seedData?: { headers: string[]; rows: any[][] } | null;
}

const AUTOSAVE_DEBOUNCE_MS = 5000;

export function SheetEditor({ sheetId, canWrite, seedData }: SheetEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<any>(null);
  const apiRef = useRef<any>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (!containerRef.current) return;
      try {
        // 동적 import — Univer SDK는 시트 열 때만 로드
        const [
          { createUniver, defaultTheme, LocaleType, merge },
          { UniverSheetsCorePreset },
          UniverPresetSheetsCoreKoKR,
        ] = await Promise.all([
          import("@univerjs/presets"),
          import("@univerjs/preset-sheets-core"),
          import("@univerjs/preset-sheets-core/locales/ko-KR"),
        ]);
        // 스타일도 동적 (별도 chunk)
        await import("@univerjs/preset-sheets-core/lib/index.css" as any);

        if (disposed) return;

        const { univer, univerAPI } = createUniver({
          locale: LocaleType.KO_KR,
          locales: {
            [LocaleType.KO_KR]: merge(
              {},
              (UniverPresetSheetsCoreKoKR as any).default || UniverPresetSheetsCoreKoKR,
            ),
          },
          theme: defaultTheme,
          presets: [
            UniverSheetsCorePreset({
              container: containerRef.current!,
            }),
          ],
        });

        univerRef.current = univer;
        apiRef.current = univerAPI;

        // 기존 저장된 데이터 로드 (snapshot은 backend yjs_state에 base64 JSON으로 저장)
        let workbookData: any = null;
        try {
          const snap = await api.get<{ state_base64: string | null }>(
            `/api/classroom/sheets/${sheetId}/snapshot-state`,
          );
          if (snap.state_base64) {
            const json = atob(snap.state_base64);
            workbookData = JSON.parse(json);
          }
        } catch {
          // 처음 열면 비어있음 — OK
        }

        if (workbookData) {
          univerAPI.createWorkbook(workbookData);
        } else if (seedData) {
          // 설문 데이터 등 초기 주입
          const sheetId1 = "sheet1";
          const cellData: Record<number, Record<number, any>> = {};
          [seedData.headers, ...seedData.rows].forEach((row, r) => {
            cellData[r] = {};
            row.forEach((v, c) => {
              cellData[r][c] = { v: v ?? "" };
            });
          });
          univerAPI.createWorkbook({
            id: `wb-${sheetId}`,
            sheetOrder: [sheetId1],
            sheets: {
              [sheetId1]: {
                id: sheetId1,
                name: "응답",
                cellData,
                rowCount: Math.max(100, seedData.rows.length + 20),
                columnCount: Math.max(26, seedData.headers.length + 5),
              },
            },
          });
        } else {
          univerAPI.createWorkbook({ id: `wb-${sheetId}` });
        }

        // 변경 감지 → 5초 디바운스 auto-save (canWrite 시에만)
        if (canWrite) {
          const wb = univerAPI.getActiveWorkbook();
          // CommandService listener (Univer 0.23 패턴)
          const cmdSvc = (univer as any).__getInjector?.()?.get?.("ICommandService");
          if (cmdSvc?.onCommandExecuted) {
            cmdSvc.onCommandExecuted(() => {
              scheduleAutoSave();
            });
          } else {
            // fallback: 30초마다 강제 저장 시도
            const interval = setInterval(() => {
              if (!disposed) saveNow().catch(() => undefined);
            }, 30000);
            (univerRef as any).__interval = interval;
          }
        }

        setLoading(false);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error("Univer init failed", e);
        setError(e?.message || "스프레드시트 로딩 실패");
        setLoading(false);
      }
    }

    function scheduleAutoSave() {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveNow().catch(() => undefined);
      }, AUTOSAVE_DEBOUNCE_MS);
    }

    async function saveNow() {
      if (!apiRef.current) return;
      try {
        const wb = apiRef.current.getActiveWorkbook();
        if (!wb) return;
        const snapshot = wb.getSnapshot ? wb.getSnapshot() : wb.save?.();
        if (!snapshot) return;
        const json = JSON.stringify(snapshot);
        const base64 = btoa(unescape(encodeURIComponent(json)));
        await api.post(`/api/classroom/sheets/${sheetId}/snapshot-state`, {
          state_base64: base64,
        });
        setSavedAt(new Date());
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("sheet auto-save failed", e);
      }
    }

    init();

    return () => {
      disposed = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if ((univerRef as any).__interval) clearInterval((univerRef as any).__interval);
      try { univerRef.current?.dispose?.(); } catch {}
      univerRef.current = null;
      apiRef.current = null;
    };
    // sheetId 바뀌면 재초기화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  if (error) {
    return (
      <div className="p-8 text-center text-status-error">
        <div className="font-medium mb-1">스프레드시트 로딩 실패</div>
        <div className="text-caption">{error}</div>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-220px)] min-h-[500px] border border-border-default rounded-lg overflow-hidden bg-white">
      {loading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
          <div className="text-caption text-text-secondary inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            스프레드시트 로딩 중... (Univer SDK)
          </div>
        </div>
      )}
      {savedAt && canWrite && (
        <div className="absolute top-2 right-3 z-20 text-[11px] text-text-tertiary bg-white/80 px-2 py-0.5 rounded">
          저장됨 · {savedAt.toLocaleTimeString("ko-KR")}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
