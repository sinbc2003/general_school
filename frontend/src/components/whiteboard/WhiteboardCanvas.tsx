"use client";

/**
 * 공유 화이트보드 — 실시간 협업 드로잉 캔버스 (Jamboard식). 교사/학생 공유 컴포넌트.
 *
 * Yjs 문서 (Hocuspocus `whiteboard-{id}`):
 *  - Y.Map("strokes") objId → 그리기 객체 (객체 단위 LWW — 본인 객체만 삭제라 충돌 없음)
 *
 * 객체 형식:
 *  {id, kind: "pen"|"hl"|"line"|"rect"|"ellipse"|"text", color, width,
 *   points?: number[] (x,y 플랫 — pen/hl/line), x?,y?,w?,h? (rect/ellipse),
 *   text?, x?,y? (text), author_id, author_name, created}
 *
 * 좌표계: 논리 1920×1080 고정 — 모든 참가자가 같은 좌표 공유, 컨테이너 폭에 맞춰 스케일.
 * 도구: 펜 / 형광펜 / 직선 / 사각형 / 원 / 텍스트 / 지우개(본인 것만, 교사는 전부)
 * 기타: 색 6종, 굵기 3종, 실행취소(본인 객체), 전체 지우기(교사), PNG 저장.
 * 스트로크는 pointerup 시점에 broadcast (그리는 중엔 로컬 미리보기).
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  Loader2, Wifi, WifiOff, Eye, Pen, Highlighter, Minus, Square, Circle,
  Type, Eraser, Undo2, Trash2, Download,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { getHocuspocusUrl } from "@/lib/collab/hocuspocus-url";

const LOGICAL_W = 1920;
const LOGICAL_H = 1080;

const COLORS = ["#1f2937", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];
const WIDTHS = [2.5, 5, 9];

export const WB_BACKGROUNDS: Record<string, { label: string; fill: string; grid?: boolean; dark?: boolean }> = {
  white: { label: "흰색", fill: "#ffffff" },
  grid: { label: "모눈", fill: "#ffffff", grid: true },
  dark: { label: "칠판", fill: "#1d2e2a", dark: true },
};

type Tool = "pen" | "hl" | "line" | "rect" | "ellipse" | "text" | "eraser";

interface WbObj {
  id: string;
  kind: Exclude<Tool, "eraser">;
  color: string;
  width: number;
  points?: number[];
  x?: number; y?: number; w?: number; h?: number;
  text?: string;
  author_id: number;
  author_name: string;
  created: number;
}

interface WbMeta {
  id: number;
  title: string;
  description?: string | null;
  background?: string;
  is_archived: boolean;
  owner_name?: string | null;
  permission: { can_read: boolean; can_write: boolean; role: string | null };
}

function newId(userId?: number): string {
  return `o-${userId ?? 0}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/** 점-선분 거리 (지우개 hit test) */
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function hitTest(o: WbObj, x: number, y: number, threshold: number): boolean {
  if (o.kind === "pen" || o.kind === "hl" || o.kind === "line") {
    const p = o.points || [];
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (distToSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) < threshold + o.width) return true;
    }
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) < threshold + o.width;
    return false;
  }
  if (o.kind === "rect" || o.kind === "ellipse") {
    const { x: ox = 0, y: oy = 0, w = 0, h = 0 } = o;
    return x >= ox - threshold && x <= ox + w + threshold && y >= oy - threshold && y <= oy + h + threshold;
  }
  if (o.kind === "text") {
    const fs = o.width * 8;
    const tw = (o.text || "").length * fs * 0.6 + 20;
    return x >= (o.x || 0) - 5 && x <= (o.x || 0) + tw && y >= (o.y || 0) - fs && y <= (o.y || 0) + fs * 0.4;
  }
  return false;
}

function drawObj(ctx: CanvasRenderingContext2D, o: WbObj) {
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.kind === "hl" ? o.width * 3.5 : o.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (o.kind === "hl") ctx.globalAlpha = 0.35;

  if (o.kind === "pen" || o.kind === "hl") {
    const p = o.points || [];
    if (p.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    } else if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (o.kind === "line") {
    const p = o.points || [];
    if (p.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.stroke();
    }
  } else if (o.kind === "rect") {
    ctx.strokeRect(o.x || 0, o.y || 0, o.w || 0, o.h || 0);
  } else if (o.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      (o.x || 0) + (o.w || 0) / 2, (o.y || 0) + (o.h || 0) / 2,
      Math.abs(o.w || 0) / 2, Math.abs(o.h || 0) / 2, 0, 0, Math.PI * 2,
    );
    ctx.stroke();
  } else if (o.kind === "text") {
    const fs = o.width * 8;
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.fillText(o.text || "", o.x || 0, o.y || 0);
  }
  ctx.restore();
}

export function WhiteboardCanvas({
  whiteboardId, headerActions, fullscreen = false,
}: {
  whiteboardId: number;
  headerActions?: ReactNode;
  /** 새 창(embed) — 라운드·테두리 없이 전체 화면 */
  fullscreen?: boolean;
}) {
  const { user } = useAuth();
  const [meta, setMeta] = useState<WbMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objects, setObjects] = useState<WbObj[]>([]);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState("");

  const yObjsRef = useRef<Y.Map<any> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<WbObj | null>(null);  // 그리는 중 객체 (로컬)
  const drawingRef = useRef(false);
  const myStackRef = useRef<string[]>([]);        // undo용 본인 객체 id
  const scaleRef = useRef(1);

  // ── 메타 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<WbMeta>(`/api/classroom/whiteboards/${whiteboardId}`);
        if (!cancelled) setMeta(res);
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || "화이트보드에 접근할 수 없습니다");
      }
    })();
    return () => { cancelled = true; };
  }, [whiteboardId]);

  // ── Yjs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!meta) return;
    const yDoc = new Y.Doc();
    const yObjs = yDoc.getMap<any>("strokes");
    yObjsRef.current = yObjs;

    const read = () => {
      const out: WbObj[] = [];
      yObjs.forEach((v) => {
        if (v && typeof v === "object" && v.id) out.push(v as WbObj);
      });
      out.sort((a, b) => (a.created || 0) - (b.created || 0));
      setObjects(out);
    };

    const prov = new HocuspocusProvider({
      url: getHocuspocusUrl(),
      name: `whiteboard-${whiteboardId}`,
      document: yDoc,
      async token() {
        await api.ensureFreshToken().catch(() => false);
        return localStorage.getItem("access_token") ?? "";
      },
      onStatus: ({ status }) => setConnected(status === "connected"),
      onAuthenticationFailed: ({ reason }) => setError(reason || "협업 서버 인증 실패"),
      onSynced: () => { read(); setSynced(true); },
    });
    try { prov.setAwarenessField("user", { name: user?.name || "익명" }); } catch { /* noop */ }
    const aw = (prov as any).awareness;
    const onAw = () => { try { setActiveCount(aw?.getStates()?.size ?? 0); } catch { /* noop */ } };
    try { aw?.on("change", onAw); onAw(); } catch { /* noop */ }
    yObjs.observe(read);

    return () => {
      yObjs.unobserve(read);
      try { aw?.off("change", onAw); } catch { /* noop */ }
      try { prov.destroy(); } catch { /* noop */ }
      try { yDoc.destroy(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboardId, meta?.id]);

  useEffect(() => {
    const id = setInterval(() => { api.ensureFreshToken().catch(() => undefined); }, 14 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const canWrite = !!meta?.permission?.can_write && synced;
  const role = meta?.permission?.role;
  const isModerator = role === "owner" || role === "admin";
  const bg = WB_BACKGROUNDS[meta?.background || "white"] || WB_BACKGROUNDS.white;

  // ── 캔버스 렌더 ──────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = scaleRef.current;

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.fillStyle = bg.fill;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    if (bg.grid) {
      ctx.strokeStyle = "rgba(100,116,139,0.18)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= LOGICAL_W; x += 48) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, LOGICAL_H); ctx.stroke();
      }
      for (let y = 0; y <= LOGICAL_H; y += 48) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(LOGICAL_W, y); ctx.stroke();
      }
    }
    for (const o of objects) drawObj(ctx, o);
    if (currentRef.current) drawObj(ctx, currentRef.current);
  }, [objects, bg]);

  // 컨테이너 크기에 맞춰 캔버스 리사이즈
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const cw = wrap.clientWidth;
      const scale = cw / LOGICAL_W;
      scaleRef.current = scale;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(LOGICAL_H * scale * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${LOGICAL_H * scale}px`;
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => { redraw(); }, [redraw]);

  // ── 포인터 → 논리 좌표 ───────────────────────────────────────────────
  const toLogical = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(LOGICAL_W, (e.clientX - rect.left) / scaleRef.current)),
      y: Math.max(0, Math.min(LOGICAL_H, (e.clientY - rect.top) / scaleRef.current)),
    };
  };

  const eraseAt = useCallback((x: number, y: number) => {
    const yObjs = yObjsRef.current;
    if (!yObjs) return;
    const threshold = 12;
    // 위에 그려진 것부터 (최신 우선)
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (!isModerator && o.author_id !== user?.id) continue;
      if (hitTest(o, x, y, threshold)) {
        yObjs.delete(o.id);
        return;
      }
    }
  }, [objects, isModerator, user?.id]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canWrite || !user) return;
    if (textInput) return; // 텍스트 입력 중
    const { x, y } = toLogical(e);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    if (tool === "eraser") {
      drawingRef.current = true;
      eraseAt(x, y);
      return;
    }
    if (tool === "text") {
      setTextInput({ x, y });
      setTextDraft("");
      return;
    }
    drawingRef.current = true;
    const base = {
      id: newId(user.id), color, width,
      author_id: user.id, author_name: user.name || `#${user.id}`, created: Date.now(),
    };
    if (tool === "pen" || tool === "hl") {
      currentRef.current = { ...base, kind: tool, points: [x, y] };
    } else if (tool === "line") {
      currentRef.current = { ...base, kind: "line", points: [x, y, x, y] };
    } else {
      currentRef.current = { ...base, kind: tool, x, y, w: 0, h: 0 };
    }
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const { x, y } = toLogical(e);
    if (tool === "eraser") { eraseAt(x, y); return; }
    const cur = currentRef.current;
    if (!cur) return;
    if (cur.kind === "pen" || cur.kind === "hl") {
      const p = cur.points!;
      const lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) > 2) p.push(x, y);
    } else if (cur.kind === "line") {
      cur.points![2] = x; cur.points![3] = y;
    } else {
      // rect/ellipse — 시작점 기준 정규화
      const sx = cur.x!, sy = cur.y!;
      cur.w = x - sx; cur.h = y - sy;
    }
    redraw();
  };

  const commitCurrent = () => {
    const cur = currentRef.current;
    currentRef.current = null;
    drawingRef.current = false;
    if (!cur) return;
    // rect/ellipse 음수 크기 정규화
    if ((cur.kind === "rect" || cur.kind === "ellipse")) {
      if ((cur.w || 0) < 0) { cur.x = (cur.x || 0) + (cur.w || 0); cur.w = Math.abs(cur.w || 0); }
      if ((cur.h || 0) < 0) { cur.y = (cur.y || 0) + (cur.h || 0); cur.h = Math.abs(cur.h || 0); }
      if ((cur.w || 0) < 3 && (cur.h || 0) < 3) { redraw(); return; }
    }
    if ((cur.kind === "pen" || cur.kind === "hl") && (cur.points?.length || 0) < 2) { redraw(); return; }
    yObjsRef.current?.set(cur.id, cur);
    myStackRef.current.push(cur.id);
  };

  const onPointerUp = () => {
    if (tool === "eraser") { drawingRef.current = false; return; }
    if (drawingRef.current) commitCurrent();
  };

  const commitText = () => {
    if (textInput && textDraft.trim() && user) {
      const id = newId(user.id);
      const obj: WbObj = {
        id, kind: "text", color, width,
        x: textInput.x, y: textInput.y, text: textDraft.trim().slice(0, 200),
        author_id: user.id, author_name: user.name || `#${user.id}`, created: Date.now(),
      };
      yObjsRef.current?.set(id, obj);
      myStackRef.current.push(id);
    }
    setTextInput(null);
    setTextDraft("");
  };

  const undo = () => {
    const yObjs = yObjsRef.current;
    if (!yObjs) return;
    while (myStackRef.current.length > 0) {
      const id = myStackRef.current.pop()!;
      if (yObjs.has(id)) { yObjs.delete(id); return; }
    }
  };

  const clearAll = () => {
    if (!isModerator) return;
    if (!confirm("화이트보드를 전부 지울까요?")) return;
    const yObjs = yObjsRef.current;
    if (!yObjs) return;
    const keys: string[] = [];
    yObjs.forEach((_v, k) => keys.push(String(k)));
    keys.forEach((k) => yObjs.delete(k));
  };

  const exportPng = () => {
    const off = document.createElement("canvas");
    off.width = LOGICAL_W; off.height = LOGICAL_H;
    const ctx = off.getContext("2d")!;
    ctx.fillStyle = bg.fill;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    for (const o of objects) drawObj(ctx, o);
    off.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${meta?.title || "whiteboard"}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  const toolDefs: { key: Tool; icon: any; label: string }[] = useMemo(() => [
    { key: "pen", icon: Pen, label: "펜" },
    { key: "hl", icon: Highlighter, label: "형광펜" },
    { key: "line", icon: Minus, label: "직선" },
    { key: "rect", icon: Square, label: "사각형" },
    { key: "ellipse", icon: Circle, label: "원" },
    { key: "text", icon: Type, label: "텍스트" },
    { key: "eraser", icon: Eraser, label: "지우개 (본인 것)" },
  ], []);

  if (error) {
    return <div className="p-10 text-center text-body text-status-error">{error}</div>;
  }
  if (!meta) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 화이트보드 불러오는 중...
      </div>
    );
  }

  return (
    <div
      className={
        fullscreen
          ? "min-h-screen bg-bg-primary"
          : "rounded-2xl overflow-hidden shadow-lg bg-bg-primary border border-border-default"
      }
    >
      {/* 헤더 */}
      <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-2 flex-wrap border-b border-border-default">
        <div className="min-w-0">
          <h2 className="text-body font-bold truncate">{meta.title}</h2>
          <div className="text-[11px] text-text-tertiary">
            {meta.owner_name && <>{meta.owner_name} · </>}
            {meta.description || "함께 그려보세요"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] bg-bg-secondary">
            {connected
              ? <Wifi size={11} className="text-emerald-500" />
              : synced ? <WifiOff size={11} className="text-red-400" /> : <Loader2 size={11} className="animate-spin" />}
            {connected ? `${Math.max(activeCount, 1)}명` : synced ? "재연결 중" : "연결 중"}
          </span>
          {meta.is_archived && (
            <span className="px-2 py-1 rounded-full text-[11px] bg-bg-secondary">보관됨 · 읽기 전용</span>
          )}
          {role === "viewer" && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] bg-bg-secondary">
              <Eye size={11} /> 공유받음 · 열람 전용
            </span>
          )}
          {headerActions}
        </div>
      </div>

      {/* 툴바 */}
      {canWrite && (
        <div className="px-4 sm:px-5 py-2 flex items-center gap-2 flex-wrap border-b border-border-default bg-bg-secondary/40">
          <div className="flex items-center gap-0.5">
            {toolDefs.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setTool(key)}
                className={`p-1.5 rounded-lg transition ${
                  tool === key ? "bg-violet-600 text-white shadow-sm" : "text-text-secondary hover:bg-bg-secondary"
                }`}
                title={label}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
          <span className="w-px h-5 bg-border-default" />
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-[18px] h-[18px] rounded-full border transition ${
                  color === c ? "ring-2 ring-violet-400 border-white scale-110" : "border-black/15 hover:scale-110"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <span className="w-px h-5 bg-border-default" />
          <div className="flex items-center gap-0.5">
            {WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  width === w ? "bg-violet-100" : "hover:bg-bg-secondary"
                }`}
                title={`굵기 ${w}`}
              >
                <span className="rounded-full bg-gray-700" style={{ width: w * 1.6, height: w * 1.6 }} />
              </button>
            ))}
          </div>
          <span className="w-px h-5 bg-border-default" />
          <button onClick={undo} className="p-1.5 rounded-lg text-text-secondary hover:bg-bg-secondary" title="실행 취소 (내 객체)">
            <Undo2 size={15} />
          </button>
          {isModerator && (
            <button onClick={clearAll} className="p-1.5 rounded-lg text-text-secondary hover:bg-red-50 hover:text-red-600" title="전체 지우기">
              <Trash2 size={15} />
            </button>
          )}
          <button onClick={exportPng} className="p-1.5 rounded-lg text-text-secondary hover:bg-bg-secondary" title="PNG 저장">
            <Download size={15} />
          </button>
        </div>
      )}

      {/* 캔버스 */}
      <div ref={wrapRef} className="relative w-full select-none" style={{ touchAction: "none" }}>
        <canvas
          ref={canvasRef}
          className={canWrite ? (tool === "eraser" ? "cursor-cell" : tool === "text" ? "cursor-text" : "cursor-crosshair") : "cursor-default"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {textInput && (
          <input
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") { setTextInput(null); setTextDraft(""); }
            }}
            onBlur={commitText}
            autoFocus
            placeholder="텍스트 입력 후 Enter"
            className="absolute px-1.5 py-0.5 text-body font-semibold bg-white/95 border border-violet-400 rounded outline-none shadow"
            style={{
              left: textInput.x * scaleRef.current,
              top: (textInput.y - width * 8) * scaleRef.current,
              color,
            }}
          />
        )}
      </div>
    </div>
  );
}
