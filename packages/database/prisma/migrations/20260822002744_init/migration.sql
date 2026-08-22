-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "RemoteType" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'FREELANCE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('INTERNSHIP', 'ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'PRINCIPAL', 'EXECUTIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'SHORTLISTED', 'CV_GENERATED', 'APPLIED', 'INTERVIEW', 'REJECTED', 'OFFER', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'READY', 'SUBMITTED', 'ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationMethod" AS ENUM ('MANUAL', 'ASSISTED', 'AUTOMATED');

-- CreateEnum
CREATE TYPE "ApplicationEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'CV_ATTACHED', 'COVER_LETTER_ATTACHED', 'SUBMITTED', 'NOTE_ADDED', 'INTERVIEW_SCHEDULED', 'EXTERNAL_UPDATE', 'ERROR');

-- CreateEnum
CREATE TYPE "JobSourceKind" AS ENUM ('ATS_BOARD', 'AGGREGATOR_API', 'PARTNER_API', 'CAREER_FEED', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "JobSourceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "ApplyMethod" AS ENUM ('EXTERNAL_URL', 'PERMITTED_API', 'MANUAL_ONLY');

-- CreateEnum
CREATE TYPE "SearchStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('KNOWN', 'VERIFIED', 'AI_INFERENCE', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('RECRUITER', 'TALENT_ACQUISITION', 'HR', 'HIRING_MANAGER', 'ENGINEERING_MANAGER', 'CTO', 'CEO', 'FOUNDER', 'OTHER');

-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'LINKEDIN_MESSAGE', 'CONTACT_FORM', 'OTHER');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'RESPONDED', 'BOUNCED', 'FOLLOW_UP_DUE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TailoredCvStatus" AS ENUM ('GENERATING', 'DRAFT', 'EDITED', 'FINAL', 'FAILED');

-- CreateEnum
CREATE TYPE "StorageDriver" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "MatchRecommendation" AS ENUM ('STRONG_MATCH', 'GOOD_MATCH', 'POSSIBLE_MATCH', 'WEAK_MATCH', 'NOT_RECOMMENDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "headline" TEXT,
    "phone" TEXT,
    "locationCity" TEXT,
    "locationCountry" TEXT,
    "timezone" TEXT,
    "yearsExperience" INTEGER,
    "desiredRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desiredLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "remotePreference" "RemoteType" NOT NULL DEFAULT 'UNKNOWN',
    "minSalary" INTEGER,
    "salaryCurrency" VARCHAR(3),
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedinUrl" TEXT,
    "githubUrl" TEXT,
    "portfolioUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" CITEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "driver" "StorageDriver" NOT NULL DEFAULT 'LOCAL',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_cvs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceFileId" UUID,
    "rawText" TEXT,
    "content" JSONB NOT NULL,
    "parseProvenance" JSONB,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_cvs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tailored_cvs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "masterCvId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "templateId" UUID,
    "status" "TailoredCvStatus" NOT NULL DEFAULT 'GENERATING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "changeSummary" JSONB,
    "generationMeta" JSONB,
    "failureReason" TEXT,
    "pdfFileId" UUID,
    "docxFileId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tailored_cvs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cv_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "engine" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "layout" JSONB NOT NULL,
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cv_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "website" TEXT,
    "domain" TEXT,
    "logoUrl" TEXT,
    "industry" TEXT,
    "sizeRange" TEXT,
    "description" TEXT,
    "linkedinUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "role" "ContactRole" NOT NULL DEFAULT 'OTHER',
    "profileUrl" TEXT,
    "email" CITEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "provenance" "Provenance" NOT NULL DEFAULT 'KNOWN',
    "emailProvenance" "Provenance" NOT NULL DEFAULT 'NOT_FOUND',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_sources" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "JobSourceKind" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "requiresCredentials" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "supportsAutoApply" BOOLEAN NOT NULL DEFAULT false,
    "termsUrl" TEXT,
    "notes" TEXT,
    "requestsPerMinute" INTEGER NOT NULL DEFAULT 30,
    "health" "JobSourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "healthDetail" TEXT,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "externalJobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "companyId" UUID,
    "companyName" TEXT NOT NULL,
    "companyWebsite" TEXT,
    "companyLogo" TEXT,
    "location" TEXT,
    "locationCity" TEXT,
    "locationCountry" TEXT,
    "remoteType" "RemoteType" NOT NULL DEFAULT 'UNKNOWN',
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'UNKNOWN',
    "experienceLevel" "ExperienceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" VARCHAR(3),
    "salaryPeriod" "SalaryPeriod" NOT NULL DEFAULT 'UNKNOWN',
    "salaryProvenance" "Provenance" NOT NULL DEFAULT 'NOT_FOUND',
    "description" TEXT NOT NULL,
    "descriptionHtml" TEXT,
    "requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "postedAt" TIMESTAMP(3),
    "postedAtKnown" BOOLEAN NOT NULL DEFAULT false,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "jobUrl" TEXT NOT NULL,
    "applicationUrl" TEXT,
    "applyMethod" "ApplyMethod" NOT NULL DEFAULT 'EXTERNAL_URL',
    "primaryContactId" UUID,
    "recruiterName" TEXT,
    "recruiterTitle" TEXT,
    "recruiterEmail" CITEXT,
    "contactSource" TEXT,
    "contactConfidence" DECIMAL(3,2),
    "contactProvenance" "Provenance" NOT NULL DEFAULT 'NOT_FOUND',
    "contentHash" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "relevanceScore" INTEGER,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_analyses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "masterCvId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "recommendation" "MatchRecommendation" NOT NULL,
    "matchingSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchingExperience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingExperience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "breakdown" JSONB,
    "reason" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "provenance" "Provenance" NOT NULL DEFAULT 'AI_INFERENCE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_searches" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filters" JSONB NOT NULL,
    "sourceKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SearchStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB,
    "queueJobId" TEXT,
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "totalNew" INTEGER NOT NULL DEFAULT 0,
    "duplicatesRemoved" INTEGER NOT NULL DEFAULT 0,
    "sourcesSucceeded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourcesFailed" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_search_results" (
    "id" UUID NOT NULL,
    "searchId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "isNewToUser" BOOLEAN NOT NULL DEFAULT true,
    "sourceKey" TEXT NOT NULL,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_search_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "scheduleCron" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "tailoredCvId" UUID,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "method" "ApplicationMethod" NOT NULL DEFAULT 'MANUAL',
    "coverLetter" TEXT,
    "notes" TEXT,
    "appliedAt" TIMESTAMP(3),
    "interviewDate" TIMESTAMP(3),
    "externalReference" TEXT,
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "type" "ApplicationEventType" NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_drafts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "jobId" UUID,
    "channel" "OutreachChannel" NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "generationMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_embeddings" (
    "jobId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_embeddings_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "cv_embeddings" (
    "masterCvId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cv_embeddings_pkey" PRIMARY KEY ("masterCvId")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key" ON "oauth_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_storageKey_key" ON "file_objects"("storageKey");

-- CreateIndex
CREATE INDEX "file_objects_userId_createdAt_idx" ON "file_objects"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "master_cvs_userId_isDefault_idx" ON "master_cvs"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "tailored_cvs_userId_createdAt_idx" ON "tailored_cvs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "tailored_cvs_jobId_idx" ON "tailored_cvs"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "tailored_cvs_userId_jobId_version_key" ON "tailored_cvs"("userId", "jobId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "cv_templates_key_key" ON "cv_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "companies_normalizedName_key" ON "companies"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "companies"("name");

-- CreateIndex
CREATE INDEX "contacts_companyId_confidence_idx" ON "contacts"("companyId", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_companyId_profileUrl_key" ON "contacts"("companyId", "profileUrl");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_companyId_email_key" ON "contacts"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "job_sources_key_key" ON "job_sources"("key");

-- CreateIndex
CREATE INDEX "job_sources_isEnabled_idx" ON "job_sources"("isEnabled");

-- CreateIndex
CREATE INDEX "jobs_contentHash_idx" ON "jobs"("contentHash");

-- CreateIndex
CREATE INDEX "jobs_postedAt_idx" ON "jobs"("postedAt" DESC);

-- CreateIndex
CREATE INDEX "jobs_discoveredAt_idx" ON "jobs"("discoveredAt" DESC);

-- CreateIndex
CREATE INDEX "jobs_companyName_idx" ON "jobs"("companyName");

-- CreateIndex
CREATE INDEX "jobs_remoteType_employmentType_experienceLevel_idx" ON "jobs"("remoteType", "employmentType", "experienceLevel");

-- CreateIndex
CREATE INDEX "jobs_isActive_postedAt_idx" ON "jobs"("isActive", "postedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_sourceId_externalJobId_key" ON "jobs"("sourceId", "externalJobId");

-- CreateIndex
CREATE INDEX "user_jobs_userId_status_idx" ON "user_jobs"("userId", "status");

-- CreateIndex
CREATE INDEX "user_jobs_userId_relevanceScore_idx" ON "user_jobs"("userId", "relevanceScore" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_jobs_userId_jobId_key" ON "user_jobs"("userId", "jobId");

-- CreateIndex
CREATE INDEX "job_analyses_userId_score_idx" ON "job_analyses"("userId", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "job_analyses_userId_jobId_masterCvId_key" ON "job_analyses"("userId", "jobId", "masterCvId");

-- CreateIndex
CREATE INDEX "job_searches_userId_createdAt_idx" ON "job_searches"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "job_searches_status_idx" ON "job_searches"("status");

-- CreateIndex
CREATE INDEX "job_search_results_jobId_idx" ON "job_search_results"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "job_search_results_searchId_jobId_key" ON "job_search_results"("searchId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_searches_userId_name_key" ON "saved_searches"("userId", "name");

-- CreateIndex
CREATE INDEX "applications_userId_status_idx" ON "applications"("userId", "status");

-- CreateIndex
CREATE INDEX "applications_userId_appliedAt_idx" ON "applications"("userId", "appliedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "applications_userId_jobId_key" ON "applications"("userId", "jobId");

-- CreateIndex
CREATE INDEX "application_events_applicationId_occurredAt_idx" ON "application_events"("applicationId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "outreach_drafts_userId_status_idx" ON "outreach_drafts"("userId", "status");

-- CreateIndex
CREATE INDEX "outreach_drafts_contactId_idx" ON "outreach_drafts"("contactId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_cvs" ADD CONSTRAINT "master_cvs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_cvs" ADD CONSTRAINT "master_cvs_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "file_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailored_cvs" ADD CONSTRAINT "tailored_cvs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailored_cvs" ADD CONSTRAINT "tailored_cvs_masterCvId_fkey" FOREIGN KEY ("masterCvId") REFERENCES "master_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailored_cvs" ADD CONSTRAINT "tailored_cvs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailored_cvs" ADD CONSTRAINT "tailored_cvs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "cv_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailored_cvs" ADD CONSTRAINT "tailored_cvs_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "file_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailored_cvs" ADD CONSTRAINT "tailored_cvs_docxFileId_fkey" FOREIGN KEY ("docxFileId") REFERENCES "file_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_jobs" ADD CONSTRAINT "user_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_jobs" ADD CONSTRAINT "user_jobs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_analyses" ADD CONSTRAINT "job_analyses_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_searches" ADD CONSTRAINT "job_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_search_results" ADD CONSTRAINT "job_search_results_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "job_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_search_results" ADD CONSTRAINT "job_search_results_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_tailoredCvId_fkey" FOREIGN KEY ("tailoredCvId") REFERENCES "tailored_cvs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_embeddings" ADD CONSTRAINT "job_embeddings_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_embeddings" ADD CONSTRAINT "cv_embeddings_masterCvId_fkey" FOREIGN KEY ("masterCvId") REFERENCES "master_cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
