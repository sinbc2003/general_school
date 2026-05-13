import {
  Home,
  BookOpen,
  Flame,
  Users,
  Trophy,
  ClipboardList,
  FlaskConical,
  Users2,
  Newspaper,
  BarChart3,
  User,
  Sparkles,
  Briefcase,
  Target,
  Library,
  type LucideIcon,
} from "lucide-react";

export interface StudentMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
  permission: string;
  newTab?: boolean;  // true면 target="_blank"
}

export const studentMenu: StudentMenuItem[] = [
  { key: "dashboard", label: "홈", icon: Home, path: "/s/dashboard", permission: "student.dashboard.view" },
  { key: "chat", label: "AI 도우미", icon: Sparkles, path: "/s/chat", permission: "chatbot.use", newTab: true },
  { key: "community", label: "커뮤니티", icon: Users, path: "/s/community", permission: "community.problem.create" },
  { key: "contest", label: "대회", icon: Trophy, path: "/s/contest", permission: "contest.participate.view" },
  { key: "assignment", label: "과제", icon: ClipboardList, path: "/s/assignment", permission: "assignment.submit.view" },
  { key: "my-portfolio", label: "나의 포트폴리오", icon: Briefcase, path: "/s/my-portfolio", permission: "student.artifact.manage" },
  { key: "career", label: "진로/진학 설계", icon: Target, path: "/s/career", permission: "student.career.manage" },
  { key: "research-archive", label: "선배 연구 자료", icon: Library, path: "/s/research-archive", permission: "student.research.browse" },
  { key: "research", label: "내 연구 일지", icon: FlaskConical, path: "/s/research", permission: "research.journal.write" },
  { key: "club", label: "동아리", icon: Users2, path: "/s/club", permission: "club.activity.write" },
  { key: "papers", label: "논문", icon: Newspaper, path: "/s/papers", permission: "papers.view" },
  { key: "ranking", label: "랭킹", icon: BarChart3, path: "/s/ranking", permission: "ranking.view" },
  { key: "profile", label: "설정", icon: User, path: "/s/profile", permission: "student.dashboard.view" },
];
