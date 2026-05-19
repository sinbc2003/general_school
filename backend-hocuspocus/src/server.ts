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
  type onChangePayload,
  type onDisconnectPayload,
  type onLoadDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";
import { config } from "./config.js";
import {
  extractDocIdFromName,
  fetchDocPermission,
  verifyToken,
  type DocPermission,
} from "./auth.js";
import {
  extractPlainText,
  loadDocSnapshot,
  storeDocSnapshot,
} from "./storage.js";

// per-document state — onChange로 debounce timer 관리
interface DocState {
  lastEditorId: number | null;
  debounceTimer: NodeJS.Timeout | null;
}
const docStates = new Map<number, DocState>();

function getOrInitDocState(docId: number): DocState {
  let s = docStates.get(docId);
  if (!s) {
    s = { lastEditorId: null, debounceTimer: null };
    docStates.set(docId, s);
  }
  return s;
}

const server = Server.configure({
  port: config.port,
  address: "0.0.0.0",

  async onAuthenticate({ token, documentName }: onAuthenticatePayload) {
    if (!token) {
      throw new Error("token required");
    }
    const payload = verifyToken(token);
    const docId = extractDocIdFromName(documentName);

    let perm: DocPermission;
    try {
      perm = await fetchDocPermission(docId, token);
    } catch (e: any) {
      throw new Error(`permission check failed: ${e?.message ?? e}`);
    }
    if (!perm.can_read) {
      throw new Error("forbidden");
    }
    // 반환값은 context로 onChange/onStoreDocument 등에서 접근 가능
    return {
      userId: parseInt(payload.sub, 10),
      role: payload.role,
      canWrite: perm.can_write,
    };
  },

  /**
   * 권한 없는 사용자의 update를 거부. Hocuspocus는 onAuthenticate에서
   * connection 자체를 막을 수 있지만, 같은 connection 내에서 read-only를
   * enforce하려면 onStateless/onAwarenessUpdate 등에서 추가 검사 필요.
   *
   * 간단화: read-only 사용자도 connection 자체는 허용 (presence 보기 위해).
   * 단 변경된 update는 onChange에서 무시 (canWrite=false 사용자 update 차단).
   *
   * 실제로 무시하려면 Hocuspocus의 readOnly extension 사용. 본 버전은 v0.1에서
   * 추가 강화 — 현재는 단순화: 권한 있는 사용자만 connection 허용 (can_read).
   */

  async onLoadDocument({ documentName, document }: onLoadDocumentPayload) {
    const docId = extractDocIdFromName(documentName);
    try {
      const state = await loadDocSnapshot(docId);
      if (state) {
        // 기존 state를 applyUpdate로 merge (CRDT 특성상 안전)
        Y.applyUpdate(document, state);
      }
    } catch (e) {
      console.error(`[hocuspocus] onLoadDocument ${docId} 실패:`, e);
    }
    return document;
  },

  async onChange({ documentName, document, context }: onChangePayload) {
    const docId = extractDocIdFromName(documentName);
    const state = getOrInitDocState(docId);
    state.lastEditorId = (context as any)?.userId ?? null;

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(async () => {
      try {
        const plain = extractPlainText(document);
        await storeDocSnapshot(docId, document, plain, state.lastEditorId);
      } catch (e) {
        console.error(`[hocuspocus] snapshot ${docId} 실패:`, e);
      }
    }, config.snapshotDebounceMs);
  },

  async onDisconnect({ documentName, document }: onDisconnectPayload) {
    // 마지막 client 떠날 때 즉시 snapshot (debounce 무시)
    const docId = extractDocIdFromName(documentName);
    const state = docStates.get(docId);
    if (state?.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    try {
      const plain = extractPlainText(document);
      await storeDocSnapshot(docId, document, plain, state?.lastEditorId ?? null);
    } catch (e) {
      console.error(`[hocuspocus] final snapshot ${docId} 실패:`, e);
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
