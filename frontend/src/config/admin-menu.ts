import {
  LayoutDashboard,
  Users,
  Shield,
  FileText,
  Trophy,
  ClipboardList,
  MessageSquare,
  FlaskConical,
  GraduationCap,
  Users2,
  Newspaper,
  Clock,
  BookOpen,
  Settings,
  Activity,
  LayoutList,
  MessageCircle,
  Bot,
  Sparkles,
  Key,
  DollarSign,
  Briefcase,
  Target,
  Library,
  Home,
  CalendarRange,
  UserPlus,
  FileArchive,
  Megaphone,
  Smartphone,
  HardDrive,
  Building2,
  Globe,
  Github,
  FileQuestion,
  Flag,
  type LucideIcon,
} from "lucide-react";
import { studentMenu } from "./student-menu";

export interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  permission?: string | null;
  superAdminOnly?: boolean;
  /**
   * 보일 역할 목록. 지정하면 그 역할에만 표시.
   * 예: ["student"] = 학생만, ["teacher", "staff"] = 교직원만.
   * 미지정 = 모든 역할 (단 permission이 별도 제한).
   */
  roles?: string[];
  /**
   * 숨길 역할 목록. roles와 반대 의미로 빠르게 제외할 때.
   */
  excludeRoles?: string[];
  /**
   * Feature Flag 키. 지정하면 해당 flag가 활성일 때만 메뉴 노출.
   * 예: feature="chatbot" → user.features.chatbot=true일 때만 보임.
   * 학교가 `/system/feature-flags`에서 ON/OFF.
   */
  feature?: string;
  newTab?: boolean;  // true면 target="_blank"로 새 창 열기
  children?: MenuItem[];
}

export const adminMenu: MenuItem[] = [
  {
    key: "dashboard",
    label: "대시보드",
    icon: LayoutDashboard,
    path: "/dashboard",
    permission: null,
  },
  {
    key: "me-setup",
    label: "내 정보 등록",
    icon: UserPlus,
    path: "/me/setup",
    permission: null,
    excludeRoles: ["student"],
  },
  {
    key: "announcements",
    label: "공지사항",
    icon: Megaphone,
    path: "/announcements",
    permission: "announcement.post.view",
  },

  // ── 학생 전용 메뉴 (교직원에게는 숨김) ──
  {
    key: "my-portfolio",
    label: "나의 포트폴리오",
    icon: Briefcase,
    path: "/s/my-portfolio",
    permission: null,
    roles: ["student"],
  },
  {
    key: "my-career",
    label: "진로/진학 설계",
    icon: Target,
    path: "/s/career",
    permission: null,
    roles: ["student"],
  },
  {
    key: "research-submit-student",
    label: "연구 보고서 제출",
    icon: FileArchive,
    path: "/s/research-submit",
    permission: null,
    roles: ["student"],
  },
  {
    key: "my-activities-student",
    label: "내 활동",
    icon: Users2,
    path: "/s/my-activities",
    permission: null,
    roles: ["student"],
  },

  // ── 교직원/관리자 메뉴 ──
  {
    key: "users",
    label: "사용자 관리",
    icon: Users,
    path: "/users",
    permission: "user.manage.view",
    excludeRoles: ["student"],
  },
  {
    key: "permissions",
    label: "권한 관리",
    icon: Shield,
    path: "/permissions",
    permission: "permission.manage.view",
    excludeRoles: ["student"],
  },
  // "학생 관리" 카테고리의 자식들 — top-level로 평탄화
  // (이전엔 'students' children 토글이었지만 한 단계 줄임)
  { key: "student-list", label: "학생 현황", icon: Users, path: "/students", permission: "portfolio.grade.view", excludeRoles: ["student"] },
  { key: "admissions", label: "진학 관리", icon: GraduationCap, path: "/admissions", permission: "admissions.record.view", excludeRoles: ["student"], feature: "admissions" },
  { key: "student-artifacts", label: "학생 산출물 갤러리", icon: Briefcase, path: "/students/artifacts-gallery", permission: "portfolio.artifact.view", excludeRoles: ["student"] },
  { key: "past-research", label: "선배 연구 보고서", icon: FileArchive, path: "/past-research", permission: "past_research.view", excludeRoles: ["student"] },
  { key: "research-review", label: "승인 대기함", icon: ClipboardList, path: "/research-review", permission: "past_research.review", excludeRoles: ["student"] },
  { key: "my-groups", label: "내 그룹", icon: Users2, path: "/my-groups", permission: "teacher_group.view", excludeRoles: ["student"] },
  { key: "research-supervisors", label: "연구 담당교사 매핑", icon: UserPlus, path: "/system/research-supervisors", permission: "past_research.supervise", excludeRoles: ["student"] },
  {
    key: "archive",
    label: "수업 자료실",
    icon: FileText,
    permission: "archive.document.upload",
    excludeRoles: ["student"],
    children: [
      { key: "documents", label: "문서 검색", icon: FileText, path: "/archive/documents", permission: "archive.document.upload" },
      { key: "problems", label: "문제 검색", icon: FileText, path: "/archive/problems", permission: "problem.library.view" },
    ],
  },
  {
    key: "contest",
    label: "대회 관리",
    icon: Trophy,
    path: "/contest",
    permission: "contest.manage.create",
    excludeRoles: ["student"],
    feature: "contest",
  },
  {
    key: "assignment",
    label: "과제 관리",
    icon: ClipboardList,
    path: "/assignment",
    permission: "assignment.manage.create",
    excludeRoles: ["student"],
  },
  {
    key: "classroom",
    label: "클래스룸",
    icon: GraduationCap,
    path: "/classroom",
    permission: "classroom.course.view",
    excludeRoles: ["student"],
  },
  {
    key: "courseware",
    label: "코스웨어",
    icon: FileQuestion,
    path: "/courseware",
    permission: "classroom.courseware.view",
    excludeRoles: ["student"],
    feature: "courseware",
  },
  {
    key: "drive",
    label: "내 드라이브",
    icon: HardDrive,
    path: "/drive",
    permission: "drive.use",
    excludeRoles: ["student"],
  },
  {
    key: "research",
    label: "연구 프로젝트",
    icon: FlaskConical,
    path: "/research",
    permission: "research.project.view",
    excludeRoles: ["student"],
    feature: "research",
  },
  {
    key: "club",
    label: "동아리",
    icon: Users2,
    path: "/club",
    permission: "club.manage.create",
    excludeRoles: ["student"],
    feature: "club",
  },
  // ※ papers (논문/뉴스레터) 메뉴 제거 — 일반 고등학교 운영에서 미사용.
  //   backend papers 라우터/모델은 그대로 둠 (필요 시 menu만 다시 추가하면 됨).
  {
    key: "timetable",
    label: "시간표",
    icon: Clock,
    path: "/timetable",
    permission: "timetable.view",
    excludeRoles: ["student"],
  },
  // ── AI 도우미 (역할별 분기) ──
  {
    key: "chat",
    label: "AI 챗봇",
    icon: Sparkles,
    path: "/chat",
    permission: "chatbot.use",
    excludeRoles: ["student"],  // 교사용
    newTab: true,
  },
  {
    key: "chat-student",
    label: "학생 AI 도우미",
    icon: Sparkles,
    path: "/s/chat",
    permission: null,
    roles: ["student"],
    newTab: true,
  },
  // ── 학생 영역 (super_admin 디버깅용 미리보기) — 교사/학생에게 숨김 ──
  // student-menu.ts 전체를 자동으로 children으로 매핑 → 학생 메뉴 추가/변경 시 자동 반영.
  {
    key: "student-area",
    label: "학생 화면 (미리보기)",
    icon: GraduationCap,
    permission: null,
    superAdminOnly: true,
    children: studentMenu.map((s) => ({
      key: `stu-${s.key}`,
      label: s.label,
      icon: s.icon,
      path: s.path,
      permission: null, // super_admin은 permission 무시되므로 null 그대로 OK
      newTab: s.newTab,
    })),
  },
  {
    key: "llm-admin",
    label: "AI 설정",
    icon: Bot,
    permission: "chatbot.provider.manage",
    excludeRoles: ["student"],
    children: [
      { key: "llm-providers", label: "Provider/API 키", icon: Key, path: "/system/llm/providers", permission: "chatbot.provider.manage" },
      { key: "llm-models", label: "모델/단가", icon: DollarSign, path: "/system/llm/models", permission: "chatbot.model.manage" },
      { key: "llm-prompts", label: "시스템 프롬프트", icon: MessageCircle, path: "/system/llm/prompts", permission: "chatbot.prompt.manage" },
      { key: "llm-config", label: "기본 설정", icon: Settings, path: "/system/llm/config", permission: "chatbot.config.manage" },
      { key: "llm-usage", label: "사용량/비용", icon: Activity, path: "/system/llm/usage", permission: "chatbot.usage.view_all" },
    ],
  },
  {
    key: "feedback-manage",
    label: "건의 관리",
    icon: MessageCircle,
    path: "/system/feedback",
    permission: "system.settings.edit",
    excludeRoles: ["student"],
  },
  {
    key: "my-devices",
    label: "내 신뢰 장치",
    icon: Smartphone,
    path: "/me/devices",
    permission: null,  // 모든 사용자 본인 장치 관리 가능
    excludeRoles: ["student"],  // 학생은 이메일 2FA 비대상이라 신뢰장치 개념 없음
  },
  {
    key: "ai-developer",
    label: "AI 개발자",
    icon: Bot,
    path: "/system/ai-developer",
    permission: "system.settings.edit",
    excludeRoles: ["student"],
  },
  {
    key: "system",
    label: "시스템",
    icon: Settings,
    superAdminOnly: true,
    children: [
      { key: "sys-departments", label: "부서 관리", icon: Building2, path: "/system/departments", permission: "department.manage" },
      { key: "sys-semesters", label: "학기 관리", icon: CalendarRange, path: "/system/semesters", permission: "system.semester.manage" },
      { key: "sys-enrollments", label: "학기별 명단", icon: UserPlus, path: "/system/enrollments", permission: "system.enrollment.manage" },
      { key: "sys-backup", label: "백업·복원", icon: FileArchive, path: "/system/backup", permission: null },
      { key: "sys-health", label: "상태", icon: Activity, path: "/system/health", permission: "system.health.view" },
      { key: "sys-logs", label: "감사 로그", icon: FileText, path: "/system/logs", permission: "system.audit.view" },
      { key: "sys-menu", label: "메뉴 관리", icon: LayoutList, path: "/system/menu", permission: "system.settings.edit" },
      { key: "sys-settings", label: "설정", icon: Settings, path: "/system/settings", permission: "system.settings.edit" },
      { key: "sys-google", label: "Google 연동", icon: Globe, path: "/system/integrations/google", permission: "google.integration.configure" },
      { key: "sys-storage", label: "스토리지", icon: HardDrive, path: "/system/storage", permission: "storage.volume.view" },
      { key: "sys-updates", label: "코드 업데이트", icon: Github, path: "/system/updates", permission: "system.updates.view" },
      { key: "sys-feature-flags", label: "기능 활성화", icon: Flag, path: "/system/feature-flags", permission: "system.feature_flags.manage" },
    ],
  },
];
