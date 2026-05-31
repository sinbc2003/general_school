"use client";

import SmtpSettings from "@/components/system/SmtpSettings";

export function StepEmail() {
  return (
    <div>
      <h3 className="text-body font-semibold text-text-primary mb-1">이메일(SMTP) 설정</h3>
      <p className="text-caption text-text-tertiary mb-4">
        교직원 로그인 인증 코드·민감정보 2차 인증 메일 발송에 필요합니다.
        지금 설정하거나, 나중에 <b>시스템 → 이메일(SMTP)</b>에서 설정할 수 있습니다. (선택)
      </p>
      <SmtpSettings />
    </div>
  );
}
