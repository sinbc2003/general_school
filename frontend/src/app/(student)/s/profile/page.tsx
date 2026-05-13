"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api/client";
import {
  User,
  Mail,
  GraduationCap,
  Lock,
  Shield,
  Eye,
  EyeOff,
  CheckCircle,
} from "lucide-react";

export default function ProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeResult, setChangeResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleChangePassword = async () => {
    setChangeResult(null);

    if (!currentPassword || !newPassword) {
      setChangeResult({ type: "error", message: "모든 항목을 입력해주세요." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangeResult({
        type: "error",
        message: "새 비밀번호가 일치하지 않습니다.",
      });
      return;
    }
    if (newPassword.length < 8) {
      setChangeResult({
        type: "error",
        message: "비밀번호는 8자 이상이어야 합니다.",
      });
      return;
    }

    setChanging(true);
    try {
      await api.put("/api/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setChangeResult({
        type: "success",
        message: "비밀번호가 변경되었습니다.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setChangeResult({
        type: "error",
        message: err?.detail || "비밀번호 변경에 실패했습니다.",
      });
    } finally {
      setChanging(false);
    }
  };

  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">설정</h1>

      {/* Profile Info */}
      <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
        <h2 className="text-body font-semibold text-text-primary mb-4">
          프로필 정보
        </h2>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
              <User size={16} className="text-accent" />
            </div>
            <div>
              <div className="text-caption text-text-tertiary">이름</div>
              <div className="text-body text-text-primary">
                {user?.name || "-"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Mail size={16} className="text-accent" />
            </div>
            <div>
              <div className="text-caption text-text-tertiary">이메일</div>
              <div className="text-body text-text-primary">
                {user?.email || "-"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
              <GraduationCap size={16} className="text-accent" />
            </div>
            <div>
              <div className="text-caption text-text-tertiary">학년/반/번호</div>
              <div className="text-body text-text-primary">
                {user?.grade ? `${user.grade}학년 ` : ""}
                {user?.class_number ? `${user.class_number}반 ` : ""}
                {user?.student_number ? `${user.student_number}번` : ""}
                {!user?.grade && !user?.class_number && !user?.student_number
                  ? "-"
                  : ""}
              </div>
            </div>
          </div>

          {user?.username && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-accent" />
              </div>
              <div>
                <div className="text-caption text-text-tertiary">아이디</div>
                <div className="text-body text-text-primary">
                  {user.username}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
        <h2 className="text-body font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Lock size={16} />
          비밀번호 변경
        </h2>

        <div className="space-y-3">
          <div>
            <label className="text-caption text-text-secondary block mb-1">
              현재 비밀번호
            </label>
            <div className="relative">
              <input
                type={showCurrentPw ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary pr-10"
                placeholder="현재 비밀번호"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw(!showCurrentPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              >
                {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-caption text-text-secondary block mb-1">
              새 비밀번호
            </label>
            <div className="relative">
              <input
                type={showNewPw ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary pr-10"
                placeholder="새 비밀번호 (8자 이상)"
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              >
                {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-caption text-text-secondary block mb-1">
              새 비밀번호 확인
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-border-default rounded-lg px-3 py-2 text-body bg-bg-primary text-text-primary"
              placeholder="새 비밀번호 확인"
            />
          </div>

          {changeResult && (
            <div
              className={`rounded-lg px-3 py-2 text-caption ${
                changeResult.type === "success"
                  ? "bg-green-50 text-green-600"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {changeResult.message}
            </div>
          )}

          <button
            onClick={handleChangePassword}
            disabled={changing}
            className="w-full py-2 bg-accent text-white rounded-lg text-body font-medium disabled:opacity-50"
          >
            {changing ? "변경 중..." : "비밀번호 변경"}
          </button>
        </div>
      </div>

      {/* 2FA */}
      <div className="bg-bg-primary rounded-lg border border-border-default p-4">
        <h2 className="text-body font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Shield size={16} />
          2단계 인증 (2FA)
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-body text-text-primary">
              TOTP 인증
            </p>
            <p className="text-caption text-text-tertiary">
              Google Authenticator 등의 앱으로 2단계 인증을 설정합니다.
            </p>
          </div>
          {user?.totp_enabled ? (
            <div className="flex items-center gap-1 text-green-600">
              <CheckCircle size={16} />
              <span className="text-caption font-medium">활성화됨</span>
            </div>
          ) : (
            <span className="text-caption text-text-tertiary px-3 py-1 rounded-full border border-border-default">
              미설정
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
