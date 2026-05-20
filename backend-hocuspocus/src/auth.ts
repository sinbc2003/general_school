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

export type TargetKind = "doc" | "deck";

export interface TargetRef {
  kind: TargetKind;
  id: number;
}

/**
 * documentName 형식:
 *   "doc-{id}"   — 협업 문서 (classroom_docs)
 *   "deck-{id}"  — 협업 프리젠테이션 deck (classroom_slides)
 *
 * frontend HocuspocusProvider의 name과 정확히 일치해야 함.
 */
export function extractTarget(documentName: string): TargetRef {
  const m = documentName.match(/^(doc|deck)-(\d+)$/);
  if (!m) {
    throw new Error(`invalid documentName: ${documentName}`);
  }
  return { kind: m[1] as TargetKind, id: parseInt(m[2], 10) };
}

/** kind별 backend resource path. */
export function resourcePath(kind: TargetKind): string {
  return kind === "deck" ? "decks" : "docs";
}

export async function fetchTargetPermission(
  target: TargetRef, token: string,
): Promise<DocPermission> {
  const url = `${config.fastapiUrl}/api/classroom/${resourcePath(target.kind)}/${target.id}/permission`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`permission lookup failed: ${res.status} ${body}`);
  }
  return (await res.json()) as DocPermission;
}
