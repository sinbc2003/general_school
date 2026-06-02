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
        <div className="space-y-3">
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
            <b>💡 가장 간단한 방법: 최고관리자 본인 메일 그대로 쓰기</b><br />
            별도 학교 메일을 새로 만들 필요 없습니다. <b>본인(최고관리자) 메일 주소</b>를 그대로 넣으면,
            로그인 인증 코드가 본인 메일로 옵니다(자기 메일로 자기 인증). 교직원이 많아지면 그때
            학교 공용 메일로 바꾸면 됩니다.
          </div>

          {/* 빠른 입력 프리셋 — 클릭하면 host/port 자동 채움 */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-gray-500">빠른 입력:</span>
            <button type="button" onClick={() => setForm({ ...form, host: "smtp.gmail.com", port: 587, use_tls: true })}
              className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50">Gmail</button>
            <button type="button" onClick={() => setForm({ ...form, host: "smtp.naver.com", port: 587, use_tls: true })}
              className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50">네이버</button>
            <button type="button" onClick={() => setForm({ ...form, host: "smtp.daum.net", port: 465, use_tls: true })}
              className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50">다음</button>
            <button type="button" onClick={() => setForm({ ...form, host: "smtp.office365.com", port: 587, use_tls: true })}
              className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50">Office365</button>
          </div>

          {/* 앱 비밀번호 발급 상세 가이드 — 펼침/접기 */}
          <details className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
            <summary className="cursor-pointer font-semibold text-gray-800">📧 앱 비밀번호 발급 방법 (모르면 여기 클릭해서 펼치기)</summary>
            <div className="mt-3 space-y-3">
              <div>
                <b className="text-gray-900">▸ Gmail</b>
                <ol className="list-decimal list-inside mt-1 space-y-0.5 leading-relaxed">
                  <li><a href="https://myaccount.google.com/security" target="_blank" rel="noopener" className="text-blue-600 underline">Google 계정 → 보안</a> 으로 이동</li>
                  <li><b>2단계 인증</b>을 먼저 켭니다 (앱 비밀번호의 선행 조건)</li>
                  <li>보안 화면에서 <b>"앱 비밀번호"</b> 검색 → 클릭</li>
                  <li>앱 이름 아무거나 입력(예: <i>학교플랫폼</i>) → <b>생성</b></li>
                  <li><b>16자리 코드</b>가 뜨면 복사 → 아래 <b>"비밀번호(앱 비밀번호)"</b> 칸에 붙여넣기</li>
                  <li>아이디 = 본인 Gmail 주소 / 위에서 <b>Gmail</b> 프리셋 클릭하면 Host·Port 자동</li>
                </ol>
              </div>
              <div>
                <b className="text-gray-900">▸ 네이버</b>
                <ol className="list-decimal list-inside mt-1 space-y-0.5 leading-relaxed">
                  <li>네이버 메일 → <b>환경설정 → POP3/IMAP 설정</b> → "POP3/SMTP 사용함"</li>
                  <li>2단계 인증을 쓰면: 내정보 → 보안 → <b>애플리케이션 비밀번호</b> 발급</li>
                  <li>2단계 인증을 안 쓰면: 네이버 <b>계정 비밀번호</b> 그대로 사용 가능</li>
                  <li>위에서 <b>네이버</b> 프리셋 클릭하면 Host·Port 자동</li>
                </ol>
              </div>
              <div className="text-gray-500 border-t border-gray-200 pt-2">
                ⚠️ Gmail은 <b>일반 로그인 비번이 아니라 "앱 비밀번호"</b>를 넣어야 합니다 (보안상 외부앱 차단).
                입력한 비밀번호는 서버에서 <b>암호화 저장</b>되며 화면에 다시 표시되지 않습니다.
                저장 후 아래 <b>"테스트 메일 보내기"</b>로 실제 도착을 꼭 확인하세요.
              </div>
            </div>
          </details>
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
