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

export function extractDocIdFromName(documentName: string): number {
  // 형식: "doc-{docId}". frontend HocuspocusProvider의 name과 일치해야 함.
  const m = documentName.match(/^doc-(\d+)$/);
  if (!m) {
    throw new Error(`invalid documentName: ${documentName}`);
  }
  return parseInt(m[1], 10);
}

export async function fetchDocPermission(
  docId: number, token: string,
): Promise<DocPermission> {
  const url = `${config.fastapiUrl}/api/classroom/docs/${docId}/permission`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`permission lookup failed: ${res.status} ${body}`);
  }
  return (await res.json()) as DocPermission;
}
