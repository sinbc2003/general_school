"use client";

import SmtpSettings from "@/components/system/SmtpSettings";

export default function EmailSettingsPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-title text-text-primary mb-2">이메일(SMTP) 설정</h1>
      <p className="text-caption text-text-tertiary mb-6">
        로그인 인증·민감정보 2차 인증 코드 메일 발송에 사용됩니다. 설정 후 테스트 메일로 실제 수신을 확인하세요.
      </p>
      <SmtpSettings />
    </div>
  );
}
