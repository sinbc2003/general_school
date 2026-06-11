/**
 * 인증 + 권한 조회.
 *
 * 1) JWT 검증 — backend FastAPI와 같은 JWT_SECRET 사용 (HS256).
 *    payload: { sub: user_id(str), role: str, exp: timestamp, type: "access" }
 * 2) 권한 조회 — FastAPI `/api/classroom/docs/{did}/permission`로 위임.
 *    문서별 can_read/can_write 판정은 backend가 진실의 원천.
 */

import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { getCached, permKey, setCached } from "./permission-cache.js";

export interface TokenPayload {
  sub: string;
  role: string;
  exp: number;
  type: string;
}

export interface DocPermission {
  can_read: boolean;
  can_write: boolean;
  can_share: boolean;
  role: "owner" | "admin" | "editor" | "viewer" | null;
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret, {
    algorithms: [config.jwtAlgorithm],
  }) as TokenPayload;
  if (decoded.type !== "access") {
    throw new Error("invalid token type");
  }
  return decoded;
}

export type TargetKind = "doc" | "deck" | "sheet" | "board" | "whiteboard";

export interface TargetRef {
  kind: TargetKind;
  id: number;
}

/**
 * documentName 형식:
 *   "doc-{id}"    — 협업 문서 (classroom_docs)
 *   "deck-{id}"   — 협업 프리젠테이션 deck (classroom_slides)
 *   "sheet-{id}"  — 협업 스프레드시트 (classroom_sheets, Univer 기반)
 *   "board-{id}"  — Padlet형 보드 (tool_board, 카드 Y.Map)
 *   "whiteboard-{id}" — 공유 화이트보드 (tool_whiteboard, 스트로크 Y.Map)
 *
 * frontend HocuspocusProvider의 name과 정확히 일치해야 함.
 */
export function extractTarget(documentName: string): TargetRef {
  const m = documentName.match(/^(doc|deck|sheet|board|whiteboard)-(\d+)$/);
  if (!m) {
    throw new Error(`invalid documentName: ${documentName}`);
  }
  return { kind: m[1] as TargetKind, id: parseInt(m[2], 10) };
}

/** kind별 backend resource path. */
export function resourcePath(kind: TargetKind): string {
  if (kind === "deck") return "decks";
  if (kind === "sheet") return "sheets";
  if (kind === "board") return "boards";
  if (kind === "whiteboard") return "whiteboards";
  return "docs";
}

/**
 * 권한 조회 (LRU 캐시 적용).
 *
 * 1500명 동접 시 매 onAuthenticate마다 FastAPI를 때리면 worker 고갈.
 * userId × (kind, targetId)당 5분 캐시. 권한 변경(공유 mode/멤버 추가)은
 * 최대 5분 지연 적용됨 — 학교 환경에서 안전한 trade-off.
 *
 * userId가 없으면 (cold call) cache bypass — 권한 조회 후에야 userId 알 수 있는
 * 경우는 없지만, 안전한 fallback.
 */
export async function fetchTargetPermission(
  target: TargetRef, token: string, userId?: number | string,
): Promise<DocPermission> {
  const cacheable = userId !== undefined && userId !== null;
  const key = cacheable ? permKey(userId, target.kind, target.id) : "";

  if (cacheable) {
    const hit = getCached<DocPermission>(key);
    if (hit) return hit;
  }

  const url = `${config.fastapiUrl}/api/classroom/${resourcePath(target.kind)}/${target.id}/permission`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`permission lookup failed: ${res.status} ${body}`);
  }
  const perm = (await res.json()) as DocPermission;

  if (cacheable) {
    setCached(key, perm);
  }
  return perm;
}
