"use client";

/**
 * 알림 종 아이콘 + 드롭다운 — 사이드바 상단에 노출.
 *
 * 동작:
 * - 60초 polling으로 unread count 갱신
 * - 클릭 시 최근 알림 10개 드롭다운
 * - 알림 클릭 → link_url 이동 + 자동 읽음 처리
 * - 빨간 점 (unread count > 0)
 * - "모두 읽음" 버튼
 *
 * 브라우저 OS 알림 (Notification API):
 * - 최초 1회 권한 요청 (clicked once)
 * - 새 알림 도착(폴링에서 count 증가 감지) 시 OS 알림 트리거
 * - 탭이 background면 OS 알림, foreground면 in-app만
 *
 * Web Push (Service Worker)는 미구현 — 브라우저 닫혀있으면 알림 안 옴.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { api } from "@/lib/api/client";

interface NotifItem {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  meta: Record<string, any>;
  is_read: boolean;
  read_at: string | null;
  created_at: string | null;
  source_user_id: number | null;
}

const POLL_INTERVAL_MS = 60_000; // 60초 — 학교 LAN 부하 X

export function NotificationBell({ collapsed }: { collapsed?: boolean }) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );
  const prevCountRef = useRef(0);

  // unread count polling
  const fetchCount = useCallback(async () => {
    try {
      const data = await api.get<{ unread_count: number }>("/api/notifications/unread-count");
      const newCount = data.unread_count;
      // 새 알림 도착 — 권한 허용된 경우 OS 알림 트리거
      if (
        permission === "granted" &&
        newCount > prevCountRef.current &&
        document.visibilityState !== "visible"
      ) {
        try {
          new Notification("새 알림", {
            body: `${newCount - prevCountRef.current}건의 새 알림이 있습니다`,
            icon: "/favicon.ico",
            tag: "gs-notif",
          });
        } catch {}
      }
      prevCountRef.current = newCount;
      setUnreadCount(newCount);
    } catch {
      // 인증 만료 등 — 조용히 무시
    }
  }, [permission]);

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchCount]);

  // 드롭다운 열 때 최근 알림 fetch
  const openDropdown = async () => {
    setOpen(true);
    try {
      const data = await api.get<{ items: NotifItem[] }>("/api/notifications?limit=15");
      setItems(data.items);
    } catch {}
  };

  // 권한 요청 — 종 아이콘 hover로 안내, 한 번 클릭하면 요청
  const requestPermission = async () => {
    if (permission === "unsupported" || permission === "granted") return;
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
    } catch {}
  };

  const handleItemClick = async (n: NotifItem) => {
    setOpen(false);
    // 읽음 처리 (best-effort)
    if (!n.is_read) {
      try {
        await api.post(`/api/notifications/${n.id}/read`, {});
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {}
    }
    if (n.link_url) router.push(n.link_url);
  };

  const markAllRead = async () => {
    try {
      await api.post("/api/notifications/read-all", {});
      setUnreadCount(0);
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {}
  };

  // 사이드바 collapsed 모드 — 작은 종 아이콘만
  if (collapsed) {
    return (
      <div className="flex justify-center py-2 border-b border-border-default relative">
        <button
          onClick={() => { requestPermission(); openDropdown(); }}
          className="relative p-1.5 hover:bg-bg-secondary rounded"
          title={unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}건` : "알림"}
        >
          <Bell size={16} className="text-text-secondary" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        {open && <DropdownPanel items={items} onClose={() => setOpen(false)} onItemClick={handleItemClick} onMarkAll={markAllRead} />}
      </div>
    );
  }

  return (
    <div className="border-b border-border-default relative">
      <button
        onClick={() => { requestPermission(); open ? setOpen(false) : openDropdown(); }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-secondary text-caption text-left"
        title={permission === "default" ? "클릭하면 브라우저 알림 권한을 요청합니다" : ""}
      >
        <div className="relative flex-shrink-0">
          <Bell size={15} className="text-text-secondary" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        <span className="flex-1 text-text-secondary">알림</span>
        {unreadCount > 0 && (
          <span className="text-[11px] text-accent font-medium">{unreadCount}</span>
        )}
        {permission === "denied" && (
          <span title="브라우저 알림 차단됨" className="inline-flex">
            <BellOff size={11} className="text-text-tertiary" />
          </span>
        )}
      </button>
      {open && <DropdownPanel items={items} onClose={() => setOpen(false)} onItemClick={handleItemClick} onMarkAll={markAllRead} />}
    </div>
  );
}

function DropdownPanel({
  items, onClose, onItemClick, onMarkAll,
}: {
  items: NotifItem[];
  onClose: () => void;
  onItemClick: (n: NotifItem) => void;
  onMarkAll: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-2 mt-1 z-50 bg-bg-primary border border-border-default rounded-lg shadow-xl w-80 max-h-[480px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
          <div className="text-caption font-semibold">알림</div>
          {items.some((n) => !n.is_read) && (
            <button
              type="button"
              onClick={onMarkAll}
              className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
            >
              <CheckCheck size={11} /> 모두 읽음
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-12 text-center text-caption text-text-tertiary">
              알림이 없습니다
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onItemClick(n)}
                className={`w-full px-3 py-2.5 text-left border-b border-border-default last:border-b-0 hover:bg-bg-secondary transition flex gap-2 ${
                  n.is_read ? "" : "bg-cream-100"
                }`}
              >
                {!n.is_read && (
                  <span className="w-1.5 h-1.5 bg-accent rounded-full flex-shrink-0 mt-1.5"></span>
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-caption truncate ${n.is_read ? "text-text-secondary" : "text-text-primary font-medium"}`}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="text-[11px] text-text-tertiary line-clamp-2 mt-0.5">
                      {n.body}
                    </div>
                  )}
                  <div className="text-[10px] text-text-tertiary mt-1">
                    {n.created_at && formatRelative(n.created_at)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const sec = Math.floor((now - d.getTime()) / 1000);
  if (sec < 60) return "방금";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}일 전`;
  return d.toLocaleDateString("ko-KR");
}
