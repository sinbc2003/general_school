import {
  Home,
  Users,
  Trophy,
  ClipboardList,
  FlaskConical,
  Users2,
  BarChart3,
  User,
  Sparkles,
  Briefcase,
  Target,
  Library,
  Megaphone,
  type LucideIcon,
} from "lucide-react";

export interface StudentMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
  // permission이 null이면 모든 학생에게 표시. 실제 데이터 접근 권한은 backend가 페이지/API에서 체크.
  // 학생 사이드바는 학생 본인이 보는 자기 영역이므로 메뉴는 단순 노출, 권한 키 mismatch로
  // 빈 사이드바가 되는 문제 방지.
  permission: string | null;
  newTab?: boolean;  // true면 target="_blank"
}

export const studentMenu: StudentMenuItem[] = [
  { key: "dashboard", label: "홈", icon: Home, path: "/s/dashboard", permission: null },
  { key: "announcements", label: "공지사항", icon: Megaphone, path: "/s/announcements", permission: null },
  { key: "chat", label: "AI 도우미", icon: Sparkles, path: "/s/chat", permission: "chatbot.use", newTab: true },
  { key: "contest", label: "대회", icon: Trophy, path: "/s/contest", permission: null },
  { key: "assignment", label: "과제", icon: ClipboardList, path: "/s/assignment", permission: null },
  { key: "my-portfolio", label: "나의 포트폴리오", icon: Briefcase, path: "/s/my-portfolio", permission: null },
  { key: "career", label: "진로/진학 설계", icon: Target, path: "/s/career", permission: null },
  { key: "research-archive", label: "과거 연구 자료", icon: Library, path: "/s/research-archive", permission: null },
  { key: "research", label: "내 연구 일지", icon: FlaskConical, path: "/s/research", permission: null },
  { key: "club", label: "동아리", icon: Users2, path: "/s/club", permission: null },
  { key: "profile", label: "설정", icon: User, path: "/s/profile", permission: null },
];
