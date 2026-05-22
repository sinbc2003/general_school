/**
 * In-memory LRU cache for FastAPI permission lookups.
 *
 * 1500명 동접 시 매 onAuthenticate마다 FastAPI를 직접 때리면
 * `/api/classroom/{kind}/{id}/permission` 가 폭주 → FastAPI worker 고갈.
 *
 * - Key: `${userId}:${kind}:${targetId}` (사용자 × 문서)
 * - TTL: 5분 (300_000 ms)
 *   → 권한 변경(공유 mode/멤버 추가)이 적용되기까지 최대 5분 지연.
 *   → 본 학교 환경에서 충분히 짧고 안전한 trade-off.
 * - Max size: 5000 entries
 *   → eviction은 Map insertion-order로 (가장 오래된 항목부터 삭제).
 *     JS Map은 insertion-order를 보존하므로 별도 자료구조 없이 LRU 흉내.
 *     hit 시 delete → set으로 ordering refresh (true LRU).
 *
 * 라이브러리 추가 없이 Map + Date 기반으로 간단하게 구현.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_SIZE = 5000;

const PERM_CACHE = new Map<string, CacheEntry<unknown>>();

/** 캐시 hit이면 value 반환, miss 또는 expired면 null. */
export function getCached<T>(key: string): T | null {
  const entry = PERM_CACHE.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    PERM_CACHE.delete(key);
    return null;
  }
  // LRU: 최근 접근한 항목을 Map의 끝으로 (insertion order refresh)
  PERM_CACHE.delete(key);
  PERM_CACHE.set(key, entry);
  return entry.value;
}

/** 캐시에 저장. MAX_SIZE 초과 시 가장 오래된 항목부터 evict. */
export function setCached<T>(key: string, value: T): void {
  // 기존 있으면 갱신을 위해 먼저 삭제 (ordering refresh)
  PERM_CACHE.delete(key);
  PERM_CACHE.set(key, { value, expiresAt: Date.now() + TTL_MS });
  // LRU eviction: 가장 먼저 들어간 항목들부터 삭제
  while (PERM_CACHE.size > MAX_SIZE) {
    const firstKey = PERM_CACHE.keys().next().value;
    if (firstKey === undefined) break;
    PERM_CACHE.delete(firstKey);
  }
}

/** 디버그/관리용 — 캐시 통째 무효화. */
export function clearCache(): void {
  PERM_CACHE.clear();
}

/** 디버그/관리용 — 현재 캐시 크기. */
export function cacheSize(): number {
  return PERM_CACHE.size;
}

/** 사용자/문서 권한 캐시 키 helper. */
export function permKey(userId: number | string, kind: string, targetId: number | string): string {
  return `${userId}:${kind}:${targetId}`;
}
