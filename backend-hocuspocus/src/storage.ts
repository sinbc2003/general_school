/**
 * Yjs 문서 ↔ FastAPI snapshot 동기화.
 *
 * - loadDocSnapshot: 문서 첫 연결 시 FastAPI에서 yjs_state(base64) 받아 Y.Doc에 apply.
 * - storeDocSnapshot: 변경 누적 → debounce 후 FastAPI에 POST.
 *
 * Hocuspocus가 in-memory에서 모든 client update를 merge → 주기적으로 본 모듈을 통해
 * DB로 snapshot. 즉 DB는 약간 stale할 수 있지만 CRDT 진실의 원천은 in-memory.
 */

import * as Y from "yjs";
import { config } from "./config.js";
import { resourcePath, type TargetRef } from "./auth.js";

export async function loadSnapshot(target: TargetRef): Promise<Uint8Array | null> {
  const url = `${config.fastapiUrl}/api/classroom/${resourcePath(target.kind)}/${target.id}/yjs-snapshot`;
  const res = await fetch(url, {
    headers: { "X-Internal-Token": config.internalToken },
  });
  if (!res.ok) {
    // 404 (없음) 또는 권한 오류. Hocuspocus는 빈 doc으로 진행.
    console.warn(`[hocuspocus] loadSnapshot ${target.kind}-${target.id} : ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { state_base64: string | null };
  if (!data.state_base64) return null;
  return Buffer.from(data.state_base64, "base64");
}

export async function storeSnapshot(
  target: TargetRef, doc: Y.Doc,
  plainText: string | null, lastEditorId: number | null,
): Promise<void> {
  const state = Y.encodeStateAsUpdate(doc);
  const url = `${config.fastapiUrl}/api/classroom/${resourcePath(target.kind)}/${target.id}/yjs-snapshot`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": config.internalToken,
    },
    body: JSON.stringify({
      state_base64: Buffer.from(state).toString("base64"),
      plain_text: plainText,
      created_by_id: lastEditorId,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[hocuspocus] storeSnapshot ${target.kind}-${target.id} 실패: ${res.status} ${body}`);
    return;
  }
}

/**
 * Y.Doc → plain text 변환 (검색용 fallback).
 *
 * TipTap은 'doc' fragment에 본문 저장. fragment를 traverse하면서 text node만 추출.
 * 형식이 안 맞으면 빈 문자열 반환.
 */
export function extractPlainText(doc: Y.Doc): string {
  try {
    // TipTap default fragment 키 = 'default'. extension-collaboration이 'default' 사용.
    const fragment = doc.getXmlFragment("default");
    if (!fragment) return "";
    return collectText(fragment);
  } catch {
    return "";
  }
}

function collectText(node: Y.XmlFragment | Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) {
    return node.toString();
  }
  let out = "";
  const children = node.toArray();
  for (const child of children) {
    if (child instanceof Y.XmlText) {
      out += child.toString();
    } else if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
      out += collectText(child);
      // 블록 단위 줄바꿈
      out += "\n";
    }
  }
  return out;
}
