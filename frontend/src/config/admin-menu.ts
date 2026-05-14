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
  type LucideIcon,
} from "lucide-react";

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
    key: "alumni-research-student",
    label: "과거 연구 자료",
    icon: Library,
    path: "/s/research-archive",
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
  { key: "admissions", label: "진학 관리", icon: GraduationCap, path: "/admissions", permission: "admissions.record.view", excludeRoles: ["student"] },
  { key: "student-artifacts", label: "공개 산출물 갤러리", icon: Briefcase, path: "/students/artifacts-gallery", permission: "portfolio.artifact.view", excludeRoles: ["student"] },
  { key: "alumni-research", label: "과거 연구 자료", icon: Library, path: "/s/research-archive", permission: "portfolio.artifact.view", excludeRoles: ["student"] },
  {
    key: "archive",
    label: "수업 자료실",
    icon: FileText,
    permission: "archive.document.upload",
    excludeRoles: ["student"],
    children: [
      { key: "documents", label: "문서 검색", icon: FileText, path: "/archive/documents", permission: "archive.document.upload" },
      { key: "problems", label: "문제 DB", icon: FileText, path: "/archive/problems", permission: "problem.library.view" },
    ],
  },
  {
    key: "contest",
    label: "대회 관리",
    icon: Trophy,
    path: "/contest",
    permission: "contest.manage.create",
    excludeRoles: ["student"],
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
    key: "meeting",
    label: "협의록",
    icon: MessageSquare,
    path: "/meeting",
    permission: "meeting.view",
    excludeRoles: ["student"],
  },
  {
    key: "research",
    label: "연구 프로젝트",
    icon: FlaskConical,
    path: "/research",
    permission: "research.project.view",
    excludeRoles: ["student"],
  },
  {
    key: "club",
    label: "동아리",
    icon: Users2,
    path: "/club",
    permission: "club.manage.create",
    excludeRoles: ["student"],
  },
  {
    key: "papers",
    label: "논문/뉴스레터",
    icon: Newspaper,
    permission: "papers.keyword.manage",
    excludeRoles: ["student"],
    children: [
      { key: "keywords", label: "키워드 관리", icon: Newspaper, path: "/papers/keywords", permission: "papers.keyword.manage" },
      { key: "feed", label: "수집 논문", icon: Newspaper, path: "/papers/feed", permission: "papers.approve" },
      { key: "newsletter", label: "뉴스레터", icon: Newspaper, path: "/papers/newsletter", permission: "papers.publish" },
    ],
  },
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
  {
    key: "student-area",
    label: "학생 화면 (미리보기)",
    icon: GraduationCap,
    permission: null,
    superAdminOnly: true,
    children: [
      { key: "stu-dashboard", label: "학생 홈", icon: Home, path: "/s/dashboard", permission: null },
      { key: "stu-portfolio", label: "나의 포트폴리오", icon: Briefcase, path: "/s/my-portfolio", permission: null },
      { key: "stu-career", label: "진로/진학 설계", icon: Target, path: "/s/career", permission: null },
      { key: "stu-research-archive", label: "과거 연구 자료", icon: Library, path: "/s/research-archive", permission: null },
      { key: "stu-chat", label: "학생 AI 도우미", icon: Sparkles, path: "/s/chat", permission: null, newTab: true },
    ],
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
      { key: "sys-semesters", label: "학기 관리", icon: CalendarRange, path: "/system/semesters", permission: "system.semester.manage" },
      { key: "sys-enrollments", label: "학기별 명단", icon: UserPlus, path: "/system/enrollments", permission: "system.enrollment.manage" },
      { key: "sys-backup", label: "백업·복원", icon: FileArchive, path: "/system/backup", permission: null },
      { key: "sys-health", label: "상태", icon: Activity, path: "/system/health", permission: "system.health.view" },
      { key: "sys-logs", label: "감사 로그", icon: FileText, path: "/system/logs", permission: "system.audit.view" },
      { key: "sys-menu", label: "메뉴 관리", icon: LayoutList, path: "/system/menu", permission: "system.settings.edit" },
      { key: "sys-settings", label: "설정", icon: Settings, path: "/system/settings", permission: "system.settings.edit" },
    ],
  },
];
