"""통합 플랫폼 모델 — 모든 테이블 등록"""

# ── Core (Phase 1) ──
from app.models.user import User, RefreshToken, TOTPSession
from app.models.permission import (
    Permission,
    RolePermission,
    UserPermission,
    PermissionGroup,
    PermissionGroupItem,
    UserPermissionGroup,
)
from app.models.audit import AuditLog
from app.models.setting import Setting, FeatureFlag, SchoolConfig

# ── Archive ──
from app.models.archive import Document, Problem, Tag, PublishedProblemSet

# ── Pipeline ──
from app.models.pipeline import PipelineJob, AgentResult, PromptTemplate, LLMUsageLog

# ── Contest ──
from app.models.contest import (
    Contest, ContestProblem, ContestParticipant,
    ContestTeam, ContestSubmission,
)

# ── Papers ──
from app.models.papers import Paper, Newsletter, CrawlKeyword, PaperNote


# ── Timetable ──
from app.models.timetable import Semester, TimetableEntry, SemesterEnrollment

# ── Assignment ──
from app.models.assignment import Assignment, AssignmentSubmission

# ── Admissions ──
from app.models.admissions import AdmissionsQuestion, AdmissionsRecord, AdmissionsResponse

# ── Research ──
from app.models.research import (
    ResearchProject, ResearchLog, ResearchSubmission, ResearchJournal,
)

# ── Club ──
from app.models.club import Club, ClubActivity, ClubSubmission

# ── Portfolio ──
from app.models.portfolio import (
    StudentGrade, StudentMockExam, StudentAward,
    StudentThesis, StudentCounseling, StudentRecord,
)

# ── Feedback ──
from app.models.feedback import Feedback, DevRequest

# ── Challenge ──
from app.models.challenge import ChallengeLevel, ChallengeProblem, ChallengeProgress

# ── Student Learning ──
from app.models.student import UserProgress, Bookmark, StudyStreak

# ── Student Self (포트폴리오 업로드 / 진로 설계) ──
from app.models.student_self import StudentArtifact, StudentCareerPlan

# ── Chatbot (AI) ──
from app.models.chatbot import (
    LLMProvider, LLMModel, SystemPrompt,
    ChatSession, ChatMessage, ChatUsageDaily, ChatbotConfig,
)

# ── Announcement (공지사항) ──
from app.models.announcement import Announcement, AnnouncementAudience

# ── Position (학기·직책 기반 권한) ──
from app.models.position import PositionTemplate, EnrollmentPosition

# ── Device (신뢰 장치 + 로그인 챌린지) ──
from app.models.device import TrustedDevice, LoginChallenge

# ── Classroom (구글 클래스룸 식 수업 운영) ──
from app.models.classroom import Course, CourseStudent, CoursePost

# ── Classroom Docs (협업 문서 — Yjs CRDT) ──
from app.models.classroom_docs import ClassroomDocument, DocumentMember, DocumentRevision

# ── Classroom Surveys (Google Forms 식 설문지) ──
from app.models.classroom_surveys import Survey, SurveyQuestion, SurveyResponse, SurveyAnswer

# ── Classroom Short Links (설문·문서 공유용 단축 URL + QR) ──
from app.models.classroom_links import ShortLink

__all__ = [
    # Core
    "User", "RefreshToken", "TOTPSession",
    "Permission", "RolePermission", "UserPermission",
    "PermissionGroup", "PermissionGroupItem", "UserPermissionGroup",
    "AuditLog", "Setting", "FeatureFlag", "SchoolConfig",
    # Archive
    "Document", "Problem", "Tag", "PublishedProblemSet",
    # Pipeline
    "PipelineJob", "AgentResult", "PromptTemplate", "LLMUsageLog",
    # Contest
    "Contest", "ContestProblem", "ContestParticipant",
    "ContestTeam", "ContestSubmission",
    # Papers
    "Paper", "Newsletter", "CrawlKeyword", "PaperNote",
    # Timetable
    "Semester", "TimetableEntry", "SemesterEnrollment",
    # Assignment
    "Assignment", "AssignmentSubmission",
    # Admissions
    "AdmissionsQuestion", "AdmissionsRecord", "AdmissionsResponse",
    # Research
    "ResearchProject", "ResearchLog", "ResearchSubmission", "ResearchJournal",
    # Club
    "Club", "ClubActivity", "ClubSubmission",
    # Portfolio
    "StudentGrade", "StudentMockExam", "StudentAward",
    "StudentThesis", "StudentCounseling", "StudentRecord",
    # Feedback
    "Feedback", "DevRequest",
    # Challenge
    "ChallengeLevel", "ChallengeProblem", "ChallengeProgress",
    # Student Learning
    "UserProgress", "Bookmark", "StudyStreak",
    # Student Self
    "StudentArtifact", "StudentCareerPlan",
    # Chatbot
    "LLMProvider", "LLMModel", "SystemPrompt",
    "ChatSession", "ChatMessage", "ChatUsageDaily", "ChatbotConfig",
    # Announcement
    "Announcement", "AnnouncementAudience",
    # Position
    "PositionTemplate", "EnrollmentPosition",
    # Device
    "TrustedDevice", "LoginChallenge",
    # Classroom
    "Course", "CourseStudent", "CoursePost",
    # Classroom Docs
    "ClassroomDocument", "DocumentMember", "DocumentRevision",
    # Classroom Surveys
    "Survey", "SurveyQuestion", "SurveyResponse", "SurveyAnswer",
    # Classroom Short Links
    "ShortLink",
]
