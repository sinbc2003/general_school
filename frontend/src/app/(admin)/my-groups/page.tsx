"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Users, ChevronDown, ChevronRight, Crown } from "lucide-react";
import { api } from "@/lib/api/client";

import { GroupDetailView, type GroupDetail, type MeInfo } from "./_components/GroupDetailView";
import { CreateGroupModal } from "./_components/CreateGroupModal";

interface Group {
  id: number;
  semester_id: number;
  name: string;
  type: string;
  description: string | null;
  owner_id: number;
  is_active: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  event: "행사", contest: "대회", research: "연구", etc: "기타",
};

export default function MyGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, GroupDetail>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [semesters, setSemesters] = useState<{ id: number; name: string; is_current: boolean }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/teacher-groups?mine=true");
      setGroups(data.items || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    api.get("/api/auth/me").then(setMe).catch(() => {});
    api.get("/api/timetable/semesters").then((d) => {
      const items = Array.isArray(d) ? d : d.items || [];
      setSemesters(items);
    }).catch(() => {});
  }, [load]);

  const expand = async (gid: number) => {
    if (expanded === gid) { setExpanded(null); return; }
    setExpanded(gid);
    if (!details[gid]) {
      try {
        const d = await api.get(`/api/teacher-groups/${gid}`);
        setDetails((p) => ({ ...p, [gid]: d }));
      } catch (e: any) { alert(`로딩 실패: ${e?.detail || e}`); }
    }
  };

  const refreshDetail = async (gid: number) => {
    const d = await api.get(`/api/teacher-groups/${gid}`);
    setDetails((p) => ({ ...p, [gid]: d }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">내 그룹</h1>
          <p className="text-caption text-text-tertiary mt-1">
            내가 owner이거나 초대받은 행사·대회·연구 그룹. 학번 검색으로 담당 학생을 등록할 수 있습니다.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
                className="px-3 py-1.5 bg-accent text-white text-body rounded inline-flex items-center gap-1">
          <Plus size={14} /> 새 그룹 만들기
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>
      ) : groups.length === 0 ? (
        <div className="p-8 text-center text-text-tertiary bg-bg-primary border border-border-default rounded-lg">
          <Users size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-body">참여 중인 그룹이 없습니다</div>
          <div className="text-caption mt-1">부장 교사가 초대하거나 본인이 만들 수 있습니다 (부장 권한 필요)</div>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.id} className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
              <button onClick={() => expand(g.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-secondary text-left">
                {expanded === g.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="text-[10px] px-1.5 py-0.5 bg-cream-100 text-blue-700 rounded">{TYPE_LABEL[g.type] || g.type}</span>
                <span className="text-body text-text-primary font-medium flex-1">{g.name}</span>
                {me?.id === g.owner_id && <Crown size={12} className="text-amber-600" />}
              </button>
              {expanded === g.id && (
                <GroupDetailView
                  gid={g.id}
                  detail={details[g.id]}
                  me={me}
                  onRefresh={() => refreshDetail(g.id)}
                  onDelete={load}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateGroupModal
          semesters={semesters}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}
