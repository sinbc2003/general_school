"use client";

/**
 * 설정 탭 — Google Forms 식 (응답·일반·기본값 섹션).
 *
 * - 응답: 익명, 다중 응답, 수정 허용 시간
 * - 일반: 접근 모드 (course_members / link_public), 응답 기간 (open/close)
 * - 제출 후: 메시지 (TODO)
 */

import { Lock, Unlock, RotateCcw, Globe, Users as UsersIcon, CalendarClock } from "lucide-react";

interface Props {
  survey: {
    is_anonymous: boolean;
    allow_multiple_responses: boolean;
    access_mode: string;
    response_edit_minutes: number;
    open_at: string | null;
    close_at: string | null;
  };
  canEdit: boolean;
  isAuthor: boolean;
  onUpdate: (patch: Record<string, unknown>) => Promise<void>;
}


/** ISO(UTC) → datetime-local input value (YYYY-MM-DDTHH:mm, 로컬 시간대) */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local input value → ISO(UTC). 빈 문자열이면 null. */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function SettingsTab({ survey, canEdit, isAuthor, onUpdate }: Props) {
  if (!isAuthor) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-10 text-center text-text-tertiary">
        설문 작성자만 설정을 변경할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 응답 섹션 */}
      <SectionCard title="응답" description="응답을 어떻게 수집하고 보호할지">
        <ToggleRow
          icon={<Lock size={16} className="text-text-tertiary" />}
          label="익명으로 응답 받기"
          hint="응답자의 이름이 기록되지 않습니다. 익명 모드에서는 중복 응답을 막을 수 없습니다."
          checked={survey.is_anonymous}
          disabled={!canEdit}
          disabledHint={!canEdit ? "초안 상태에서만 변경 가능" : undefined}
          onChange={(v) => onUpdate({ is_anonymous: v })}
        />
        <Divider />
        <ToggleRow
          icon={<RotateCcw size={16} className="text-text-tertiary" />}
          label="응답자가 여러 번 응답 허용"
          hint="끄면 한 사용자가 한 번만 응답할 수 있습니다(실명 모드 한정)."
          checked={survey.allow_multiple_responses}
          disabled={!canEdit}
          disabledHint={!canEdit ? "초안 상태에서만 변경 가능" : undefined}
          onChange={(v) => onUpdate({ allow_multiple_responses: v })}
        />
        <Divider />
        <NumberRow
          icon={<Unlock size={16} className="text-text-tertiary" />}
          label="응답 후 수정 허용 시간"
          hint="응답 제출 후 N분 동안 수정 가능. 0이면 제출 즉시 잠금."
          value={survey.response_edit_minutes}
          min={0}
          max={10080}
          suffix="분"
          onSave={(v) => onUpdate({ response_edit_minutes: v })}
        />
      </SectionCard>

      {/* 응답 기간 섹션 */}
      <SectionCard
        title="응답 기간"
        description="설정한 기간 외에는 자동으로 응답이 차단됩니다 (게시 중이어도). 비워두면 무제한."
      >
        <DateTimeRow
          icon={<CalendarClock size={16} className="text-text-tertiary" />}
          label="응답 시작 시간"
          hint="이 시간 이전에는 학생이 응답할 수 없습니다. 비우면 즉시 시작."
          value={survey.open_at}
          onSave={(v) => onUpdate({ open_at: v })}
        />
        <Divider />
        <DateTimeRow
          icon={<CalendarClock size={16} className="text-text-tertiary" />}
          label="응답 마감 시간"
          hint="이 시간 이후에는 응답을 받지 않습니다. 비우면 마감 없음."
          value={survey.close_at}
          onSave={(v) => onUpdate({ close_at: v })}
        />
      </SectionCard>

      {/* 접근 섹션 */}
      <SectionCard title="응답자" description="누가 이 설문에 응답할 수 있는지">
        <RadioRow
          icon={<UsersIcon size={16} className="text-text-tertiary" />}
          label="강좌 수강생"
          hint="이 강좌에 등록된 학생과 교사만 응답할 수 있습니다."
          name="access_mode"
          value="course_members"
          checked={survey.access_mode === "course_members"}
          disabled={!canEdit}
          onChange={(v) => onUpdate({ access_mode: v })}
        />
        <Divider />
        <RadioRow
          icon={<Globe size={16} className="text-text-tertiary" />}
          label="링크가 있는 모든 인증 사용자"
          hint="공유 링크를 알고 로그인한 사용자라면 누구나 응답할 수 있습니다(학교 LAN 가정)."
          name="access_mode"
          value="link_public"
          checked={survey.access_mode === "link_public"}
          disabled={!canEdit}
          onChange={(v) => onUpdate({ access_mode: v })}
        />
      </SectionCard>
    </div>
  );
}


function SectionCard({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border-default">
        <div className="text-body font-semibold text-text-primary">{title}</div>
        {description && (
          <div className="text-caption text-text-tertiary mt-0.5">{description}</div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border-default mx-6" />;
}

function ToggleRow({
  icon, label, hint, checked, disabled, disabledHint, onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="px-6 py-4 flex items-start gap-3">
      {icon && <div className="mt-0.5">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-body text-text-primary">{label}</div>
        {hint && <div className="text-caption text-text-tertiary mt-0.5">{hint}</div>}
        {disabled && disabledHint && (
          <div className="text-caption text-amber-700 mt-0.5">{disabledHint}</div>
        )}
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          checked ? "bg-[#673ab7]" : "bg-gray-300"
        } disabled:opacity-40`}
        aria-pressed={checked}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function DateTimeRow({
  icon, label, hint, value, onSave,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  value: string | null;
  onSave: (iso: string | null) => void;
}) {
  return (
    <div className="px-6 py-4 flex items-start gap-3">
      {icon && <div className="mt-0.5">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-body text-text-primary">{label}</div>
        {hint && <div className="text-caption text-text-tertiary mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <input
          type="datetime-local"
          defaultValue={isoToLocalInput(value)}
          onBlur={(e) => {
            const newIso = localInputToIso(e.target.value);
            // 현재 값과 비교 — 다를 때만 저장
            const currentIso = value;
            const cur = currentIso ? new Date(currentIso).getTime() : null;
            const next = newIso ? new Date(newIso).getTime() : null;
            if (cur !== next) onSave(newIso);
          }}
          className="px-2 py-1 border border-border-default rounded bg-white text-body min-w-[200px]"
        />
        {value && (
          <button
            type="button"
            onClick={() => onSave(null)}
            className="text-caption text-text-tertiary hover:text-status-error px-1.5 py-1"
            title="제거 (제한 없음)"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}


function NumberRow({
  icon, label, hint, value, min, max, suffix, onSave,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  onSave: (v: number) => void;
}) {
  return (
    <div className="px-6 py-4 flex items-start gap-3">
      {icon && <div className="mt-0.5">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-body text-text-primary">{label}</div>
        {hint && <div className="text-caption text-text-tertiary mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <input
          type="number"
          min={min}
          max={max}
          defaultValue={value}
          onBlur={(e) => {
            let v = Number(e.target.value) || 0;
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            if (v !== value) onSave(v);
          }}
          className="w-20 px-2 py-1 border border-border-default rounded bg-white text-center text-body"
        />
        {suffix && <span className="text-caption text-text-tertiary">{suffix}</span>}
      </div>
    </div>
  );
}

function RadioRow({
  icon, label, hint, name, value, checked, disabled, onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label
      className={`px-6 py-4 flex items-start gap-3 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-bg-secondary"
      }`}
    >
      {icon && <div className="mt-0.5">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-body text-text-primary">{label}</div>
        {hint && <div className="text-caption text-text-tertiary mt-0.5">{hint}</div>}
      </div>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 accent-[#673ab7] flex-shrink-0"
      />
    </label>
  );
}
