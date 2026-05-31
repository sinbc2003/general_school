"use client";

/**
 * SMTP(이메일 발송) 설정 — 최고관리자가 학교 메일 서버를 화면에서 구성.
 * 설정페이지(/system/email)와 온보딩 마법사가 공유한다.
 * 비밀번호는 백엔드에서 Fernet 암호화 저장되고, 조회 시 평문은 절대 내려오지 않음
 * (password_set 여부만). "테스트 메일 보내기"로 실제 도달을 확인할 수 있다.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

interface Props {
  /** 마법사 단계에서 저장 성공 시 콜백 (다음 단계로 진행 등) */
  onSaved?: () => void;
  compact?: boolean;
}

export default function SmtpSettings({ onSaved, compact }: Props) {
  const [form, setForm] = useState({
    host: "", port: 587, user: "", password: "", from_addr: "", use_tls: true,
  });
  const [passwordSet, setPasswordSet] = useState(false);
  const [source, setSource] = useState<"db" | "env" | "none">("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const c: any = await api.get("/api/system/email/config");
      setForm({
        host: c.host || "", port: c.port || 587, user: c.user || "",
        password: "", from_addr: c.from_addr || "", use_tls: !!c.use_tls,
      });
      setPasswordSet(!!c.password_set);
      setSource(c.source || "none");
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.detail?.message || e?.detail || "불러오기 실패" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.put("/api/system/email/config", form);
      setMsg({ kind: "ok", text: "저장되었습니다. '테스트 메일 보내기'로 실제 수신을 확인하세요." });
      await load();
      onSaved?.();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.detail?.message || e?.detail || "저장 실패" });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true); setMsg(null);
    try {
      const r: any = await api.post("/api/system/email/test", { to: testTo || undefined });
      setMsg({ kind: "ok", text: `테스트 메일을 ${r.sent_to} 로 보냈습니다. 받은편지함(스팸함 포함)을 확인하세요.` });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.detail?.message || e?.detail || "발송 실패 — 설정값을 확인하세요." });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="text-sm text-gray-500">로딩 중...</div>;

  const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          <b>가장 쉬운 방법: Gmail 앱 비밀번호</b> (무료) — Google 계정 → 보안 → 2단계 인증 켜기 →
          앱 비밀번호 생성(16자리). Host <code>smtp.gmail.com</code>, Port <code>587</code>, TLS 켬,
          아이디=Gmail 주소, 비밀번호=앱 비밀번호. 학교 메일 서버가 있으면 그 정보를 입력하세요.
        </div>
      )}
      {msg && (
        <div className={`rounded-lg p-3 text-sm ${msg.kind === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg.text}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>SMTP 서버 (Host)</label>
          <input className={inputCls} placeholder="smtp.gmail.com" value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>포트 (Port)</label>
          <input className={inputCls} type="number" placeholder="587" value={form.port}
            onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 587 })} />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input id="use_tls" type="checkbox" checked={form.use_tls}
            onChange={(e) => setForm({ ...form, use_tls: e.target.checked })} />
          <label htmlFor="use_tls" className="text-sm text-gray-700">TLS 사용 (권장)</label>
        </div>
        <div>
          <label className={labelCls}>아이디 (보내는 계정)</label>
          <input className={inputCls} placeholder="school@gmail.com" value={form.user}
            onChange={(e) => setForm({ ...form, user: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>발신자 표시(From) — 비우면 아이디</label>
          <input className={inputCls} placeholder="school@gmail.com" value={form.from_addr}
            onChange={(e) => setForm({ ...form, from_addr: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>
            비밀번호 (앱 비밀번호) {passwordSet && <span className="text-green-600">— 설정됨 (변경 시에만 입력)</span>}
          </label>
          <input className={inputCls} type="password"
            placeholder={passwordSet ? "변경하려면 새 비밀번호 입력 (비우면 기존 유지)" : "앱 비밀번호 16자리"}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white text-sm hover:bg-blue-700 disabled:opacity-60">
          {saving ? "저장 중..." : "저장"}
        </button>
        <span className="text-xs text-gray-400">현재 적용: {source === "db" ? "DB 설정" : source === "env" ? "서버 .env" : "미설정"}</span>
      </div>

      <div className="border-t pt-4">
        <label className={labelCls}>테스트 메일 받을 주소 (비우면 본인 이메일)</label>
        <div className="flex items-center gap-2">
          <input className={inputCls + " flex-1"} placeholder="me@example.com" value={testTo}
            onChange={(e) => setTestTo(e.target.value)} />
          <button onClick={sendTest} disabled={testing}
            className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 text-sm hover:bg-blue-50 disabled:opacity-60 whitespace-nowrap">
            {testing ? "보내는 중..." : "테스트 메일 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
