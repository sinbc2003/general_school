/**
 * 인증된 파일 다운로드 헬퍼.
 *
 * 이전엔 `<a href="${API_URL}${file_url}">`로 직접 다운로드했으나
 * /storage가 익명 접근 가능했음. 이제 /api/files/storage/... 인증 endpoint를
 * 거치므로 Authorization 헤더 필요 → fetch + blob 패턴.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";


/**
 * 파일 다운로드 — Authorization 헤더 자동 주입 후 blob으로 다운로드.
 *
 * 입력:
 *   - storagePath: "/storage/artifacts/15/1715_x.pdf" 같은 backend file_url
 *     또는 "/api/files/storage/..." 풀 경로
 *   - filename: 다운로드 파일명 (없으면 path 끝 부분)
 */
export async function downloadSecure(
  storagePath: string,
  filename?: string,
): Promise<void> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";

  // 다양한 입력 정규화:
  //   /storage/x         → ${API_URL}/api/files/storage/x
  //   /api/files/...     → ${API_URL}/api/files/...
  //   http://...         → 그대로
  let fullUrl: string;
  if (storagePath.startsWith("http")) {
    fullUrl = storagePath;
  } else if (storagePath.startsWith("/api/")) {
    fullUrl = `${API_URL}${storagePath}`;
  } else if (storagePath.startsWith("/storage/")) {
    fullUrl = `${API_URL}/api/files${storagePath}`;
  } else {
    fullUrl = `${API_URL}/${storagePath.replace(/^\/+/, "")}`;
  }

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (err: any) {
    alert(`다운로드 실패: ${err.message}`);
    return;
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      // body가 JSON이 아닌 경우 무시
    }
    alert(`다운로드 실패: ${detail}`);
    return;
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename || storagePath.split("/").pop() || "file";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 약간의 지연 후 revoke (Safari 대응)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}


/**
 * 인증 파일을 받아 PDF Blob URL 반환 — 브라우저 내장 뷰어 미리보기(iframe src)용.
 *
 * 렌더링은 클라이언트 브라우저가 수행하므로 서버 CPU/RAM 추가 부담 없음
 * (서버는 다운로드와 동일하게 바이트만 전송). 호출 측은 사용 후 revokeObjectURL().
 */
export async function fetchPdfBlobUrl(storagePath: string): Promise<string | null> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : "";
  let fullUrl: string;
  if (storagePath.startsWith("http")) fullUrl = storagePath;
  else if (storagePath.startsWith("/api/")) fullUrl = `${API_URL}${storagePath}`;
  else if (storagePath.startsWith("/storage/")) fullUrl = `${API_URL}/api/files${storagePath}`;
  else fullUrl = `${API_URL}/${storagePath.replace(/^\/+/, "")}`;
  try {
    const res = await fetch(fullUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const d = await res.json(); detail = d?.detail || detail; } catch {}
      alert(`미리보기 실패: ${detail}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    return URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
  } catch (err: any) {
    alert(`미리보기 실패: ${err.message}`);
    return null;
  }
}
