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

# ── Meeting ──
from app.models.meeting import Meeting, MeetingAttachment

# ── Timetable ──
from app.models.timetable import Semester, TimetableEntry

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

# ── Community ──
from app.models.community import CommunityProblem, CommunitySolution, CommunityVote

# ── Student Learning ──
from app.models.student import UserProgress, Bookmark, StudyStreak

# ── Student Self (포트폴리오 업로드 / 진로 설계) ──
from app.models.student_self import StudentArtifact, StudentCareerPlan

# ── Chatbot (AI) ──
from app.models.chatbot import (
    LLMProvider, LLMModel, SystemPrompt,
    ChatSession, ChatMessage, ChatUsageDaily, ChatbotConfig,
)

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
    # Meeting
    "Meeting", "MeetingAttachment",
    # Timetable
    "Semester", "TimetableEntry",
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
    # Community
    "CommunityProblem", "CommunitySolution", "CommunityVote",
    # Student Learning
    "UserProgress", "Bookmark", "StudyStreak",
    # Student Self
    "StudentArtifact", "StudentCareerPlan",
    # Chatbot
    "LLMProvider", "LLMModel", "SystemPrompt",
    "ChatSession", "ChatMessage", "ChatUsageDaily", "ChatbotConfig",
]
