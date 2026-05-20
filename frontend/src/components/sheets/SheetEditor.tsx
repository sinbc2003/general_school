"use client";

/**
 * 협업 스프레드시트 편집기 — fortune-sheet (MIT) + Yjs + Hocuspocus.
 *
 * **번들 최적화**: fortune-sheet은 react/canvas 의존 → 동적 import + ssr:false.
 * 학생 일반 페이지 진입 시 영향 0KB (Next.js webpack chunk 자동 분리).
 *
 * **실시간 협업**:
 *  - HocuspocusProvider name = `sheet-{sheetId}` (기존 deck-/doc- 패턴과 동일)
 *  - Y.Doc 안에 Y.Map("snapshot") 으로 fortune-sheet 데이터 통째 보관
 *  - onChange → snapshot 직렬화 → Y.Map.set (350ms 디바운스)
 *  - Y.Map observe → snapshot 역직렬화 → fortune-sheet 재렌더
 *  - 셀 동시 입력 시 Yjs CRDT가 자동 머지 — 같은 셀이 부딪히면 마지막 update 우선
 *  - awareness로 다른 사용자 커서·이름 broadcast (Hocuspocus 기본 제공)
 *
 * 백엔드 저장:
 *  - Hocuspocus가 sheet-{id}/yjs-snapshot POST 주기 저장
 *  - 별도 frontend snapshot-state 호출 불필요 (Hocuspocus 사이드카가 담당)
 */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import * as Y from "yjs";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import { api } from "@/lib/api/client";

const DEFAULT_HOCUSPOCUS_URL =
  process.env.NEXT_PUBLIC_HOCUSPOCUS_URL || "ws://localhost:1234";

// fortune-sheet — SSR off (canvas + window 의존)
const Workbook = dynamic(
  () => import("@fortune-sheet/react").then((m) => m.Workbook),
  { ssr: false, loading: () => <SheetLoading /> },
);

interface SheetEditorProps {
  sheetId: number;
  canWrite: boolean;
  userId: number;
  userName: string;
  /** 초기 데이터 — 설문 등 외부 주입. 비우면 빈 시트.
   *  형식: { headers, rows } */
  seedData?: { headers: string[]; rows: any[][] } | null;
  hocuspocusUrl?: string;
}

// Y.Map 안의 key 1개 — 시트 전체 snapshot. 셀별 분리는 추후 phase.
// 통째 snapshot이라 셀 충돌은 마지막 writer 우선 (LWW). 350ms 이내 동시
// 입력은 머지 — 학교 환경에선 동일 셀 동시 입력이 드물어 수용 가능.
const SNAPSHOT_KEY = "snapshot";
const DEBOUNCE_MS = 350;

function userColor(uid: number): string {
  const hue = (uid * 137) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

export function SheetEditor({
  sheetId, canWrite, userId, userName, seedData,
  hocuspocusUrl = DEFAULT_HOCUSPOCUS_URL,
}: SheetEditorProps) {
  const [data, setData] = useState<any[]>(makeEmptySheet());
  const [status, setStatus] = useState<WebSocketStatus>(WebSocketStatus.Connecting);
  const [authError, setAuthError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const yMapRef = useRef<Y.Map<any> | null>(null);
  // 자기 자신의 broadcast로 인한 무한 루프 차단 플래그
  const applyingRemoteRef = useRef(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Y.Doc + Hocuspocus 한 번만 setup
  useEffect(() => {
    const yDoc = new Y.Doc();
    docRef.current = yDoc;
    const yMap = yDoc.getMap<any>("sheet");
    yMapRef.current = yMap;

    const prov = new HocuspocusProvider({
      url: hocuspocusUrl,
      name: `sheet-${sheetId}`,
      document: yDoc,
      async token() {
        await api.ensureFreshToken().catch(() => false);
        return localStorage.getItem("access_token") ?? "";
      },
      onStatus: ({ status: s }) => setStatus(s),
      onAuthenticationFailed: ({ reason }) => setAuthError(reason || "인증 실패"),
      onSynced: () => {
        // 초기 sync 완료 — Y.Map의 snapshot이 있으면 그대로 사용,
        // 없으면 seedData 또는 빈 시트로 시작
        const remote = yMap.get(SNAPSHOT_KEY);
        if (remote && Array.isArray(remote)) {
          applyingRemoteRef.current = true;
          setData(remote);
          setTimeout(() => { applyingRemoteRef.current = false; }, 0);
        } else if (seedData) {
          const initial = buildSheetFromSeed(seedData);
          setData(initial);
          // 최초 1명이 seed 박아넣음 (있으면 그대로 사용)
          if (canWrite) {
            applyingRemoteRef.current = true;
            yMap.set(SNAPSHOT_KEY, initial);
            setTimeout(() => { applyingRemoteRef.current = false; }, 0);
          }
        }
        setReady(true);
      },
    });
    providerRef.current = prov;

    // awareness — 사용자 색·이름 broadcast (fortune-sheet 자체 cursor 표시는 별도이지만,
    // 다른 사용자가 누구인지 식별 가능하게 색만 등록)
    try {
      prov.setAwarenessField("user", {
        name: userName,
        color: userColor(userId),
      });
    } catch {}

    // Y.Map observe — 다른 사용자의 변경을 받음
    const onYMapChange = (_event: Y.YMapEvent<any>, transaction: Y.Transaction) => {
      // 내가 일으킨 변경(transaction.local)은 무시 — onChange가 이미 처리
      if (transaction.local) return;
      const remote = yMap.get(SNAPSHOT_KEY);
      if (remote && Array.isArray(remote)) {
        applyingRemoteRef.current = true;
        setData(remote);
        // setData가 비동기적으로 onChange를 안 부르도록 짧은 시간 후 해제
        setTimeout(() => { applyingRemoteRef.current = false; }, 50);
      }
    };
    yMap.observe(onYMapChange);

    return () => {
      yMap.unobserve(onYMapChange);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try { prov.destroy(); } catch {}
      try { yDoc.destroy(); } catch {}
    };
    // sheetId·url 바뀌면 재초기화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId, hocuspocusUrl]);

  // 14분마다 access_token 백그라운드 갱신
  useEffect(() => {
    const id = setInterval(() => {
      api.ensureFreshToken().catch(() => undefined);
    }, 14 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // fortune-sheet onChange — 디바운스 후 Y.Map.set으로 broadcast
  const handleChange = (newData: any[]) => {
    setData(newData);
    if (applyingRemoteRef.current || !canWrite) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const yMap = yMapRef.current;
      if (!yMap) return;
      try {
        yMap.set(SNAPSHOT_KEY, newData);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[Sheet] Y.Map.set failed", e);
      }
    }, DEBOUNCE_MS);
  };

  if (authError) {
    return (
      <div className="border border-status-error bg-red-50 rounded-lg p-6 text-center">
        <div className="text-status-error font-medium mb-2">협업 서버 인증 실패</div>
        <div className="text-caption text-text-secondary mb-4">{authError}</div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          페이지 새로고침
        </button>
      </div>
    );
  }

  return (
    <div className="border border-border-default rounded-lg bg-white overflow-hidden flex flex-col">
      {/* 상태 바 */}
      <div className="border-b border-border-default px-3 py-1.5 flex items-center gap-3 bg-bg-secondary">
        <StatusBadge status={status} />
        {!canWrite && (
          <span className="text-caption text-text-tertiary">읽기 전용</span>
        )}
        {ready && (
          <span className="text-caption text-text-tertiary ml-auto">
            동시 편집 활성 · 변경은 ~350ms 후 동기화
          </span>
        )}
      </div>

      {/* fortune-sheet workbook */}
      <div className="relative" style={{ height: "calc(100vh - 230px)", minHeight: 500 }}>
        {ready ? (
          <Workbook
            data={data as any}
            onChange={handleChange as any}
            allowEdit={canWrite}
            lang="ko"
            showFormulaBar
            showToolbar
            showSheetTabs
          />
        ) : (
          <SheetLoading />
        )}
      </div>
    </div>
  );
}


function StatusBadge({ status }: { status: WebSocketStatus }) {
  if (status === WebSocketStatus.Connected) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-status-success">
        <Wifi size={11} /> 동기화 중
      </span>
    );
  }
  if (status === WebSocketStatus.Connecting) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
        <Loader2 size={11} className="animate-spin" /> 연결 중...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-status-warning">
      <WifiOff size={11} /> 연결 끊김 (재시도)
    </span>
  );
}

function SheetLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-white">
      <div className="text-caption text-text-secondary inline-flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" />
        스프레드시트 로딩 중...
      </div>
    </div>
  );
}

// ── 데이터 헬퍼 ──

function makeEmptySheet(): any[] {
  return [
    {
      name: "Sheet1",
      celldata: [],
      row: 80,
      column: 26,
    },
  ];
}

function buildSheetFromSeed(seed: { headers: string[]; rows: any[][] }): any[] {
  // fortune-sheet 형식: celldata = [{ r, c, v: { v: value, ct: { fa: "General", t: "g" } } }, ...]
  const celldata: any[] = [];
  // 헤더 (굵게)
  seed.headers.forEach((h, c) => {
    celldata.push({
      r: 0, c,
      v: { v: h, m: String(h), ct: { fa: "General", t: "s" }, bl: 1 },
    });
  });
  // 데이터
  seed.rows.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val == null || val === "") return;
      celldata.push({
        r: r + 1, c,
        v: { v: val, m: String(val), ct: { fa: "General", t: "g" } },
      });
    });
  });
  return [
    {
      name: "응답",
      celldata,
      row: Math.max(80, seed.rows.length + 20),
      column: Math.max(26, seed.headers.length + 5),
    },
  ];
}
