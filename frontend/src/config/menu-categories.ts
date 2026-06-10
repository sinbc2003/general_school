import {
  Briefcase,
  BookOpen,
  Trophy,
  GraduationCap,
  Users2,
  Search,
  Settings,
  Home,
  PenTool,
  Flame,
  Sparkles,
  HardDrive,
  Bell,
  Wrench,
  type LucideIcon,
} from "lucide-react";



export interface MenuCategory {
  id: string;
  name: string;
  icon: string;        // lucide icon name (serializable)
  items: string[];     // menu item keys
  flat?: boolean;      // true면 카테고리 헤더/토글 없이 항목을 최상위 단독 링크로 렌더
}

export interface MenuCategoriesConfig {
  admin: MenuCategory[];
  student: MenuCategory[];
}

// 아이콘 이름 → 컴포넌트 매핑
export const iconMap: Record<string, LucideIcon> = {
  Briefcase,
  BookOpen,
  Trophy,
  GraduationCap,
  Users2,
  Search,
  Settings,
  Home,
  PenTool,
  Flame,
  Sparkles,
  HardDrive,
  Bell,
  Wrench,
};

// admin items = adminMenu의 top-level key들
// student items = studentMenu의 key들
export const defaultCategories: MenuCategoriesConfig = {
  admin: [
    {
      // 헤더 없이 최상위 단독 링크로 렌더(flat). 공지사항·대시보드를 분류 없이 노출.
      // 상단의 알림 종(NotificationBell)과는 별개 — 종은 개인 알림함, 여기는 공지/대시보드 메뉴.
      id: "top",
      name: "",
      icon: "Bell",
      items: ["announcements", "dashboard"],
      flat: true,
    },
    {
      id: "drive",
      name: "드라이브",
      icon: "HardDrive",
      items: ["drive"],
    },
    {
      id: "work",
      name: "업무",
      icon: "Briefcase",
      items: ["me-setup", "timetable"],
    },
    {
      id: "my-area",
      name: "나의 영역",
      icon: "GraduationCap",
      // 학생 전용 항목 — admin 메뉴에 두지만 roles=["student"]라 교사에겐 숨김
      items: ["my-portfolio", "my-career", "research-submit-student", "my-activities-student", "chat-student"],
    },
    {
      id: "teaching",
      name: "수업",
      icon: "BookOpen",
      // 수업 자료실 + 클래스룸 + 코스웨어 + 대회·과제 + 동아리·연구 + 생활기록부 통합
      items: ["archive", "classroom", "courseware", "contest", "assignment", "club", "research", "record-writer"],
    },
    {
      id: "edutools",
      name: "업무 및 수업 도구",
      icon: "Wrench",
      // 에듀테크 자체 구현 — 라이브 퀴즈(Kahoot형) 등. 허브 /tools
      items: ["edutools"],
    },
    {
      id: "students",
      name: "학생 관리",
      icon: "GraduationCap",
      // 토글 한 단계 줄임 — 학생 관리 카테고리 직속 메뉴
      items: ["student-list", "admissions", "student-artifacts", "past-research", "research-review", "my-groups"],
    },
    {
      id: "ai",
      name: "AI",
      icon: "Sparkles",
      // AI 챗봇 단일 — llm-admin은 관리 카테고리로 이동
      items: ["chat"],
    },
    {
      id: "student-view",
      name: "학생 화면",
      icon: "GraduationCap",
      items: ["student-area"],
    },
    {
      id: "management",
      name: "관리",
      icon: "Settings",
      items: ["users", "permissions", "research-supervisors", "llm-admin", "feedback-manage", "ai-developer", "system"],
    },
  ],
  student: [
    {
      id: "drive",
      name: "드라이브",
      icon: "HardDrive",
      items: ["my-drive"],
    },
    {
      id: "main",
      name: "홈",
      icon: "Home",
      items: ["dashboard", "announcements", "chat"],
    },
    {
      id: "class",
      name: "수업",
      icon: "BookOpen",
      items: ["classroom", "courseware", "wrong-notes", "quiz-join", "enrollment-wizard", "my-docs"],
    },
    {
      id: "competition",
      name: "대회/과제",
      icon: "Trophy",
      items: ["contest", "assignment"],
    },
    {
      id: "career",
      name: "나의 진로",
      icon: "GraduationCap",
      items: ["my-portfolio", "my-records", "career", "past-research", "research-submit"],
    },
    {
      id: "activity",
      name: "활동",
      icon: "Users2",
      items: ["my-activities", "research", "club"],
    },
    {
      id: "mypage",
      name: "내 정보",
      icon: "GraduationCap",
      items: ["me-setup", "profile"],
    },
  ],
};
