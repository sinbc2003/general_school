"use client";

/**
 * 협업 문서 공유 modal — Google Docs 식 권한 다이얼로그.
 *
 *  ┌────────────────────────────────────────┐
 *  │ ✕  공유 — <문서 제목>                    │
 *  ├────────────────────────────────────────┤
 *  │ [사용자 검색...]            [추가]        │
 *  │                                        │
 *  │ ── 권한이 있는 사용자 ──                  │
 *  │ • 신병철 (소유자)                         │
 *  │ • 김학생   [편집자 ▼]  [×]                │
 *  ├────────────────────────────────────────┤
 *  │ 일반 액세스                              │
 *  │ [강좌 멤버 ▼]                            │
 *  │  - 강좌 멤버: 강좌의 모든 학생·교사       │
 *  │  - 지정 사용자만: 위 list만               │
 *  │  - 링크 공유: 단축 링크 있는 누구나        │
 *  ├────────────────────────────────────────┤
 *  │ [🔗 단축 링크 생성/관리]                  │
 *  └────────────────────────────────────────┘
 */

import { useEffect, useMemo, useState } from "react";
import {
  X, UserPlus, Trash2, Globe, Users, Lock, Link as LinkIcon, Crown,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import ShareLinkModal from "./ShareLinkModal";
import { UserPicker } from "./UserPicker";

type AccessMode = "course_members" | "specific_users" | "link_public";
type MemberRole = "editor" | "viewer";

interface Member {
  id: number;
  user_id: number;
  user_name: string;
  role: MemberRole;
}

interface UserSuggest {
  id: number;
  name: string;
  email?: string;
  role: string;
}

type EntityType = "doc" | "sheet" | "deck" | "hwp";

const ENTITY_PATH: Record<EntityType, string> = {
  doc: "docs",
  sheet: "sheets",
  deck: "decks",
  hwp: "hwps",
};

interface ShareDocModalProps {
  docId: number;
  docTitle: string;
  ownerId: number;
  /** 사용자가 admin이거나 owner인지 — share 권한 */
  canShare: boolean;
  currentAccessMode: AccessMode;
  onClose: () => void;
  /** 변경 사항이 있어 부모가 reload해야 할 때 */
  onChanged: () => void;
  /** 도구 종류 — URL base 결정. default "doc" (기존 호환). */
  entityType?: EntityType;
}

const ACCESS_OPTIONS: { value: AccessMode; label: string; desc: string; icon: any }[] = [
  { value: "course_members", label: "강좌 멤버", desc: "강좌의 모든 교사·학생", icon: Users },
  { value: "specific_users", label: "지정 사용자만", desc: "위 list에 있는 사람만", icon: Lock },
  { value: "link_public", label: "링크 공유", desc: "단축 링크 있는 누구나 (인증 필요)", icon: Globe },
];

export function ShareDocModal({
  docId, docTitle, ownerId, canShare, currentAccessMode, onClose, onChanged,
  entityType = "doc",
}: ShareDocModalProps) {
  const basePath = `/api/classroom/${ENTITY_PATH[entityType]}`;
  const [members, setMembers] = useState<Member[]>([]);
  const [accessMode, setAccessMode] = useState<AccessMode>(currentAccessMode);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<UserSuggest[]>([]);
  const [showLink, setShowLink] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const data = await api.get<{ items: Member[] }>(`${basePath}/${docId}/members`);
      setMembers(data.items);
    } catch {}
  };
  useEffect(() => { load(); }, [docId]);

  // 검색 debounce
  useEffect(() => {
    if (!search.trim() || search.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const data = await api.get<{ items: UserSuggest[] }>(
          `/api/users?search=${encodeURIComponent(search)}&page_size=8`,
        );
        setSuggestions(data.items.filter((u) => u.id !== ownerId));
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSearch(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, ownerId]);

  const addMember = async (userId: number, userName: string) => {
    try {
      await api.post(`${basePath}/${docId}/members`, {
        user_id: userId, role: "editor",
      });
      await load();
      setSearch("");
      setSuggestions([]);
      onChanged();
      toast.show(`${userName} 추가됨`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "추가 실패", "error");
    }
  };

  const removeMember = async (uid: number, name: string) => {
    if (!confirm(`${name}의 권한을 제거합니까?`)) return;
    try {
      await api.delete(`${basePath}/${docId}/members/${uid}`);
      await load();
      onChanged();
      toast.show(`${name} 제거됨`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "제거 실패", "error");
    }
  };

  const changeRole = async (uid: number, name: string, newRole: MemberRole) => {
    try {
      // POST same endpoint with role — backend가 dup 시 role 업데이트
      await api.post(`${basePath}/${docId}/members`, {
        user_id: uid, role: newRole,
      });
      await load();
      toast.show(`${name} → ${newRole === "editor" ? "편집자" : "뷰어"}`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "변경 실패", "error");
    }
  };

  const changeAccessMode = async (mode: AccessMode) => {
    setAccessMode(mode);
    try {
      await api.put(`${basePath}/${docId}`, { access_mode: mode });
      onChanged();
      const label = ACCESS_OPTIONS.find((o) => o.value === mode)?.label || mode;
      toast.show(`일반 액세스 → ${label}`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "변경 실패", "error");
      setAccessMode(currentAccessMode);
    }
  };

  const selectedMode = ACCESS_OPTIONS.find((o) => o.value === accessMode);
  const SelectedIcon = selectedMode?.icon || Users;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
            <h2 className="text-body font-semibold truncate">"{docTitle}" 공유</h2>
            <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded-full">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* 사용자 추가 — 교사/학생 탭 + 부서/학년/반 필터 + 그룹 일괄 추가 */}
            {canShare && (
              <div className="px-5 py-4 border-b border-border-default">
                <UserPicker
                  excludedUserIds={[ownerId, ...members.map((m) => m.user_id)]}
                  onPick={async (ids) => {
                    for (const id of ids) {
                      try {
                        await api.post(`${basePath}/${docId}/members`, {
                          user_id: id, role: "editor",
                        });
                      } catch (e: any) {
                        // 일부 실패해도 다음 user 진행 (예: 권한 부족)
                        console.warn(`[share] add member ${id} failed`, e);
                      }
                    }
                    await load();
                    if (ids.length > 1) {
                      toast.show(`${ids.length}명 추가 완료`, "success");
                    }
                  }}
                />
              </div>
            )}

            {/* 권한 있는 사용자 list */}
            <div className="px-5 py-4">
              <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                권한이 있는 사용자
              </div>
              <div className="space-y-1">
                {/* 소유자 — 항상 표시 */}
                <div className="flex items-center gap-2 px-2 py-2 text-body">
                  <Crown size={13} className="text-amber-600 flex-shrink-0" />
                  <span className="flex-1 truncate">소유자 (#{ownerId})</span>
                  <span className="text-[11px] text-text-tertiary">모든 권한</span>
                </div>
                {members.length === 0 ? (
                  <div className="text-caption text-text-tertiary px-2 py-2">
                    아직 추가된 사용자가 없습니다
                  </div>
                ) : (
                  members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-2 py-2 text-body group hover:bg-bg-secondary rounded">
                      <span className="flex-1 truncate">{m.user_name}</span>
                      {canShare ? (
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.user_id, m.user_name, e.target.value as MemberRole)}
                          className="text-caption border border-border-default rounded px-1.5 py-0.5 bg-bg-primary"
                        >
                          <option value="editor">편집자</option>
                          <option value="viewer">뷰어</option>
                        </select>
                      ) : (
                        <span className="text-caption text-text-tertiary">
                          {m.role === "editor" ? "편집자" : "뷰어"}
                        </span>
                      )}
                      {canShare && (
                        <button
                          onClick={() => removeMember(m.user_id, m.user_name)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-status-error rounded"
                          title="제거"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 일반 액세스 */}
            <div className="px-5 py-4 border-t border-border-default">
              <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                일반 액세스
              </div>
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: accessMode === "link_public" ? "#dbeafe" : "#f3f4f6",
                    color: accessMode === "link_public" ? "#1d4ed8" : "#4b5563",
                  }}
                >
                  <SelectedIcon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  {canShare ? (
                    <select
                      value={accessMode}
                      onChange={(e) => changeAccessMode(e.target.value as AccessMode)}
                      className="text-body border border-border-default rounded px-2 py-1.5 bg-bg-primary w-full"
                    >
                      {ACCESS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-body font-medium">{selectedMode?.label}</div>
                  )}
                  <div className="text-caption text-text-tertiary mt-1">
                    {selectedMode?.desc}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 푸터 — 링크 공유 */}
          <div className="px-5 py-3 border-t border-border-default flex items-center justify-between bg-bg-secondary">
            <button
              type="button"
              onClick={() => setShowLink(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-caption text-accent hover:bg-bg-primary rounded"
            >
              <LinkIcon size={13} /> 단축 링크 / QR
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
            >
              완료
            </button>
          </div>
        </div>
      </div>

      {showLink && (
        <ShareLinkModal
          targetType="document"
          targetId={docId}
          targetTitle={docTitle}
          onClose={() => setShowLink(false)}
        />
      )}
    </>
  );
}
