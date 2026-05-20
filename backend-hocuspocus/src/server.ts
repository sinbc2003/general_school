/**
 * Hocuspocus 협업 문서 서버 — Yjs CRDT 동기화.
 *
 * 흐름:
 *  1. 클라이언트(브라우저) → ws://host:1234/?token={JWT}&documentName=doc-{id}
 *  2. onAuthenticate: JWT 검증 + FastAPI에 권한 조회 (can_read 없으면 reject)
 *  3. onLoadDocument: FastAPI에서 yjs_state 받아 Y.Doc에 apply
 *  4. 클라이언트들의 update를 in-memory에서 merge
 *  5. onChange: snapshot debounce timer 설정
 *  6. 일정 시간 후 storeDocSnapshot으로 FastAPI에 POST → DB 저장
 *
 * 운영 시:
 *  - JWT_SECRET / HOCUSPOCUS_INTERNAL_TOKEN backend와 동일 필수
 *  - FASTAPI_URL은 같은 호스트의 8002 (localhost). 외부에서 본 서버 직접 접근 X.
 *  - PORT 1234. nginx/Caddy로 WS proxy 또는 직접 노출 (학교 LAN 내부).
 */

import {
  Server,
  type onAuthenticatePayload,
  type onAwarenessUpdatePayload,
  type onChangePayload,
  type onDisconnectPayload,
  type onLoadDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";
import { config } from "./config.js";
import {
  extractTarget,
  fetchTargetPermission,
  verifyToken,
  type DocPermission,
  type TargetRef,
} from "./auth.js";
import {
  extractPlainText,
  loadSnapshot,
  storeSnapshot,
} from "./storage.js";

// per-document state — onChange로 debounce timer 관리
interface DocState {
  lastEditorId: number | null;
  debounceTimer: NodeJS.Timeout | null;
  target: TargetRef;
}
const docStates = new Map<string, DocState>();

function stateKey(target: TargetRef): string {
  return `${target.kind}-${target.id}`;
}

function getOrInitDocState(target: TargetRef): DocState {
  const key = stateKey(target);
  let s = docStates.get(key);
  if (!s) {
    s = { lastEditorId: null, debounceTimer: null, target };
    docStates.set(key, s);
  }
  return s;
}

const server = Server.configure({
  port: config.port,
  address: "0.0.0.0",

  async onAuthenticate({ token, documentName, connection }: onAuthenticatePayload) {
    if (!token) {
      console.warn(`[hocuspocus] auth reject: no token (${documentName})`);
      throw new Error("token required");
    }
    let payload;
    try {
      payload = verifyToken(token);
    } catch (e: any) {
      console.warn(`[hocuspocus] auth reject: JWT verify failed (${documentName}): ${e?.message ?? e}`);
      throw e;
    }
    const target = extractTarget(documentName);

    let perm: DocPermission;
    try {
      perm = await fetchTargetPermission(target, token);
    } catch (e: any) {
      console.warn(`[hocuspocus] auth reject: permission lookup failed (${documentName}): ${e?.message ?? e}`);
      throw new Error(`permission check failed: ${e?.message ?? e}`);
    }
    if (!perm.can_read) {
      console.warn(`[hocuspocus] auth reject: can_read=false uid=${payload.sub} target=${documentName}`);
      throw new Error("forbidden");
    }

    if (!perm.can_write) {
      connection.readOnly = true;
    }

    console.log(
      `[hocuspocus] auth OK uid=${payload.sub} role=${payload.role} ` +
      `target=${documentName} canWrite=${perm.can_write}`,
    );

    return {
      userId: parseInt(payload.sub, 10),
      role: payload.role,
      canWrite: perm.can_write,
    };
  },

  async onConnect({ documentName }) {
    console.log(`[hocuspocus] connect → ${documentName}`);
  },

  async onLoadDocument({ documentName, document }: onLoadDocumentPayload) {
    const target = extractTarget(documentName);
    try {
      const state = await loadSnapshot(target);
      if (state) {
        Y.applyUpdate(document, state);
        console.log(`[hocuspocus] loaded snapshot ${documentName} bytes=${state.length}`);
      } else {
        console.log(`[hocuspocus] no snapshot, fresh ${documentName}`);
      }
    } catch (e) {
      console.error(`[hocuspocus] onLoadDocument ${documentName} 실패:`, e);
    }
    return document;
  },

  async onChange({ documentName, document, context, update }: onChangePayload) {
    const target = extractTarget(documentName);
    const state = getOrInitDocState(target);
    state.lastEditorId = (context as any)?.userId ?? null;

    const bytes = (update as Uint8Array | undefined)?.length ?? 0;
    console.log(
      `[hocuspocus] change ${documentName} editor=${state.lastEditorId} ` +
      `bytes=${bytes}`,
    );

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(async () => {
      try {
        const plain = extractPlainText(document);
        await storeSnapshot(target, document, plain, state.lastEditorId);
      } catch (e) {
        console.error(`[hocuspocus] snapshot ${documentName} 실패:`, e);
      }
    }, config.snapshotDebounceMs);
  },

  async onAwarenessUpdate({
    documentName, awareness, added, updated, removed,
  }: onAwarenessUpdatePayload) {
    if (added.length || removed.length) {
      const states = Array.from(awareness.getStates().entries()).map(
        ([id, s]: any) => `${id}:${s?.user?.name ?? "?"}`,
      );
      console.log(
        `[hocuspocus] awareness ${documentName} added=${added.length} ` +
        `removed=${removed.length} states=[${states.join(",")}]`,
      );
    }
  },

  async onDisconnect({ documentName, document }: onDisconnectPayload) {
    // 마지막 client 떠날 때 즉시 snapshot (debounce 무시)
    const target = extractTarget(documentName);
    const state = docStates.get(`${target.kind}-${target.id}`);
    if (state?.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    try {
      const plain = extractPlainText(document);
      await storeSnapshot(target, document, plain, state?.lastEditorId ?? null);
    } catch (e) {
      console.error(`[hocuspocus] final snapshot ${documentName} 실패:`, e);
    }
  },
});

async function main() {
  await server.listen();
  console.log(
    `[hocuspocus] 협업 문서 서버 시작 — port ${config.port}, ` +
    `fastapi=${config.fastapiUrl}, snapshot=${config.snapshotDebounceMs}ms`,
  );
}

main().catch((e) => {
  console.error("[hocuspocus] startup failed:", e);
  process.exit(1);
});

// 우아한 종료 (snapshot 마무리)
async function shutdown(signal: string) {
  console.log(`[hocuspocus] ${signal} 수신 — 종료 중...`);
  // 진행 중인 debounce 모두 즉시 flush
  for (const [docId, state] of docStates.entries()) {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }
    // 마지막 snapshot은 onDisconnect에서 처리됨 — close 시 자동 호출
  }
  await server.destroy();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
