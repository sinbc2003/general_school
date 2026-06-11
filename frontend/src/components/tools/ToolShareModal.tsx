"use client";

/**
 * 에듀테크 도구 공유 모달 — 보드·단어장 공통.
 *
 * 동료 교사에게 원본 열람 권한 공유. 공유받은 교사는:
 *  - 원본을 열람 (보드 실시간 보기 / 단어장 학습 미리보기)
 *  - "사본 만들기"로 본인 소유 복사본 생성 → 본인 강좌에 첨부 (원본 보존)
 *
 * basePath 예: /api/classroom/boards/{id} 또는 /api/tools/wordbook/decks/{id}
 * (하위에 /shares, /shares/{sid} 규약 동일)
 */

import { useCallback, useEffect, useState } from "react";
import { X, Share2, Trash2, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { UserPicker } from "@/components/classroom/UserPicker";

interface ShareRow {
  id: number;
  user_id: number;
  name: string;
  email?: string | null;
}

interface Props {
  title: string;        // 모달 헤더에 표시할 도구 이름
  basePath: string;     // e.g. `/api/classroom/boards/3`
  onClose: () => void;
}

export function ToolShareModal({ title, basePath, onClose }: Props) {
  const [shares, setShares] = useState<ShareRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: ShareRow[] }>(`${basePath}/shares`);
      setShares(res.items || []);
    } catch {
      setShares([]);
    }
  }, [basePath]);

  useEffect(() => { load(); }, [load]);

  const add = async (userIds: number[]) => {
    for (const uid of userIds) {
      try {
        await api.post(`${basePath}/shares`, { user_id: uid });
      } catch (e: any) {
        alert(e?.detail || "공유 실패");
      }
    }
    await load();
  };

  const remove = async (sid: number) => {
    try {
      await api.delete(`${basePath}/shares/${sid}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "해제 실패");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 size={17} className="text-violet-600 flex-shrink-0" />
            <h2 className="text-body font-medium truncate">동료 교사와 공유 — {title}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded flex-shrink-0">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="text-[11.5px] text-text-tertiary bg-bg-secondary rounded-lg px-3 py-2 leading-relaxed">
            공유받은 교사는 원본을 <b>열람</b>할 수 있고, 본인 수업에 쓰려면
            <b> 사본을 만들어</b> 가져갑니다 (원본은 보존).
          </div>

          {/* 현재 공유 목록 */}
          <div>
            <div className="text-caption font-semibold text-text-secondary mb-2">
              공유 중 {shares ? `(${shares.length}명)` : ""}
            </div>
            {shares === null ? (
              <div className="flex items-center text-text-tertiary text-caption py-3">
                <Loader2 size={13} className="animate-spin mr-1.5" /> 불러오는 중...
              </div>
            ) : shares.length === 0 ? (
              <div className="text-caption text-text-tertiary py-2">
                아직 공유한 교사가 없습니다.
              </div>
            ) : (
              <ul className="space-y-1">
                {shares.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 px-3 py-1.5 border border-border-default rounded-lg"
                  >
                    <span className="text-body flex-1 truncate">{s.name}</span>
                    {s.email && (
                      <span className="text-[11px] text-text-tertiary truncate">{s.email}</span>
                    )}
                    <button
                      onClick={() => remove(s.id)}
                      className="p-1 text-text-tertiary hover:text-red-600 rounded flex-shrink-0"
                      title="공유 해제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 교사 검색 + 추가 */}
          <div>
            <div className="text-caption font-semibold text-text-secondary mb-2">교사 추가</div>
            <UserPicker
              excludedUserIds={(shares || []).map((s) => s.user_id)}
              onPick={add}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
