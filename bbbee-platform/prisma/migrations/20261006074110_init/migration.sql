-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMINISTRATOR', 'VERIFICATION_MANAGER', 'VERIFICATION_ANALYST', 'TECHNICAL_SIGNATORY', 'READ_ONLY_REVIEWER', 'CLIENT_USER');

-- CreateEnum
CREATE TYPE "EntityClassification" AS ENUM ('EME', 'QSE', 'GENERIC', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('DRAFT', 'EVIDENCE_COLLECTION', 'ANALYSIS', 'AWAITING_CLIENT', 'VERIFICATION_MANAGER_REVIEW', 'TECHNICAL_REVIEW', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DocumentClass" AS ENUM ('CIPC', 'FINANCIAL_STATEMENTS', 'MANAGEMENT_ACCOUNTS', 'TRIAL_BALANCE', 'GENERAL_LEDGER', 'PAYROLL', 'EMPLOYEE_LISTING', 'EEA2', 'EEA4', 'ORGANOGRAM', 'WSP', 'ATR', 'TRAINING_INVOICE', 'PROOF_OF_PAYMENT', 'LEARNERSHIP_AGREEMENT', 'BURSARY_AGREEMENT', 'SUPPLIER_LISTING', 'SUPPLIER_CERTIFICATE', 'AFFIDAVIT', 'SHARE_CERTIFICATE', 'SHARE_REGISTER', 'SHAREHOLDER_AGREEMENT', 'MOI', 'TRUST_DEED', 'BENEFICIARY_DOCUMENTATION', 'ENTERPRISE_DEVELOPMENT', 'SUPPLIER_DEVELOPMENT', 'SED_DOCUMENTATION', 'BANK_STATEMENT', 'INVOICE', 'CONFIRMATION_LETTER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('HEURISTIC', 'AI_AGENT', 'HUMAN');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'NOT_SCANNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('RECEIVED', 'QUARANTINED', 'CLASSIFIED', 'EXTRACTED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ScorecardElementCode" AS ENUM ('OWNERSHIP', 'MANAGEMENT_CONTROL', 'SKILLS_DEVELOPMENT', 'PREFERENTIAL_PROCUREMENT', 'SUPPLIER_DEVELOPMENT', 'ENTERPRISE_DEVELOPMENT', 'SOCIO_ECONOMIC_DEVELOPMENT', 'SECTOR_SPECIFIC', 'GENERAL');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('NATIVE_TEXT', 'SPREADSHEET_PARSE', 'DOCX_PARSE', 'OCR', 'AI_AGENT', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('VERIFIED', 'PARTIALLY_VERIFIED', 'INSUFFICIENT', 'INVALID', 'OUTSIDE_PERIOD', 'DUPLICATE', 'CONFLICTING', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('UNREVIEWED', 'CONFIRMED', 'REJECTED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "EvidenceLinkTarget" AS ENUM ('CALCULATION_INPUT', 'FINDING', 'QUERY', 'SHAREHOLDER', 'EMPLOYEE', 'TRAINING_RECORD', 'SUPPLIER', 'PROCUREMENT_TRANSACTION', 'DEVELOPMENT_CONTRIBUTION', 'SED_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "RegulatoryDocumentType" AS ENUM ('ACT', 'AMENDMENT_ACT', 'CODES_OF_GOOD_PRACTICE', 'SECTOR_CODE', 'CODE_AMENDMENT', 'GAZETTE_NOTICE', 'VERIFICATION_MANUAL', 'PRACTICE_GUIDE', 'CLARIFICATION', 'APPROVED_INTERPRETATION', 'OTHER_GUIDANCE');

-- CreateEnum
CREATE TYPE "RegulatoryStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FormulaType" AS ENUM ('PROPORTIONAL', 'BINARY_THRESHOLD', 'BANDED', 'CUSTOM_HANDLER');

-- CreateEnum
CREATE TYPE "RoundingMethod" AS ENUM ('NONE', 'HALF_UP_2DP', 'TRUNCATE_2DP', 'HALF_UP_0DP');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('DOCUMENT_EVIDENCE_AGENT', 'CODE_APPLICABILITY_AGENT', 'OWNERSHIP_AGENT', 'MANAGEMENT_CONTROL_AGENT', 'SKILLS_AGENT', 'PROCUREMENT_AGENT', 'ESD_AGENT', 'SED_AGENT', 'VERIFICATION_MANAGER_AGENT', 'TECHNICAL_REVIEW_AGENT', 'VERIFICATION_ASSISTANT');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED_OUTPUT', 'CACHED');

-- CreateEnum
CREATE TYPE "QueryPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'CLIENT_RESPONDED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CalculationStatus" AS ENUM ('CALCULATED', 'REGULATORY_CONFIGURATION_REQUIRED', 'INSUFFICIENT_INPUTS', 'ERROR');

-- CreateEnum
CREATE TYPE "TechnicalReviewDecision" AS ENUM ('PENDING', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "SnapshotMilestone" AS ENUM ('INITIAL_ASSESSMENT', 'CLIENT_QUERY_ROUND', 'VERIFICATION_MANAGER_REVIEW', 'TECHNICAL_REVIEW', 'FINAL_APPROVED_VERSION');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sanasAccreditation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientUserAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientUserAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasuredEntity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "vatNumber" TEXT,
    "industryDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasuredEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEngagement" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "measuredEntityId" TEXT NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'DRAFT',
    "managerId" TEXT,
    "analystId" TEXT,
    "signatoryId" TEXT,
    "regulatoryVersionId" TEXT,
    "regulatoryConfirmedAt" TIMESTAMP(3),
    "scorecardTemplateId" TEXT,
    "entityClassification" "EntityClassification" NOT NULL DEFAULT 'UNDETERMINED',
    "classificationBasis" JSONB,
    "verifiedTurnover" DECIMAL(20,2),
    "previousCertificateExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementPeriod" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "financialYearEnd" DATE NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentClass" "DocumentClass" NOT NULL DEFAULT 'UNKNOWN',
    "classificationSource" "ClassificationSource" NOT NULL DEFAULT 'HEURISTIC',
    "classificationConfidence" "Confidence" NOT NULL DEFAULT 'UNVERIFIED',
    "classifiedById" TEXT,
    "classifiedAt" TIMESTAMP(3),
    "elementHint" "ScorecardElementCode",
    "status" "ProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "duplicateOfId" TEXT,
    "sourceArchiveId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "detectedType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanDetail" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentExtraction" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "method" "ExtractionMethod" NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "pageCount" INTEGER,
    "text" TEXT,
    "tables" JSONB,
    "metadata" JSONB,
    "cacheKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "element" "ScorecardElementCode",
    "indicatorCode" TEXT,
    "dataKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceLocation" JSONB NOT NULL,
    "originalValue" TEXT NOT NULL,
    "normalisedValue" JSONB NOT NULL,
    "unit" TEXT NOT NULL,
    "extractionMethod" "ExtractionMethod" NOT NULL,
    "confidence" "Confidence" NOT NULL DEFAULT 'UNVERIFIED',
    "status" "EvidenceStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "agentRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "targetType" "EvidenceLinkTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'SUPPORTS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryFramework" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sectorCodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectorCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryDocument" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "documentType" "RegulatoryDocumentType" NOT NULL,
    "gazetteNumber" TEXT,
    "noticeNumber" TEXT,
    "publicationDate" DATE,
    "effectiveDate" DATE,
    "expiryDate" DATE,
    "sector" TEXT,
    "version" TEXT NOT NULL,
    "status" "RegulatoryStatus" NOT NULL DEFAULT 'DRAFT',
    "supersededById" TEXT,
    "sha256" TEXT,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryVersion" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "RegulatoryStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATE,
    "validTo" DATE,
    "publishedOn" DATE,
    "supersedesId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNotes" TEXT,
    "regressionStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryVersionDocument" (
    "regulatoryVersionId" TEXT NOT NULL,
    "regulatoryDocumentId" TEXT NOT NULL,

    CONSTRAINT "RegulatoryVersionDocument_pkey" PRIMARY KEY ("regulatoryVersionId","regulatoryDocumentId")
);

-- CreateTable
CREATE TABLE "RegulatoryProvision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "statement" TEXT,
    "section" TEXT,
    "subsection" TEXT,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "sector" TEXT,
    "element" "ScorecardElementCode",
    "indicatorCode" TEXT,
    "keywords" TEXT[],
    "status" "RegulatoryStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryProvision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardTemplate" (
    "id" TEXT NOT NULL,
    "regulatoryVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityClassification" "EntityClassification" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScorecardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardElement" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "element" "ScorecardElementCode" NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "weighting" DECIMAL(10,4),
    "bonusAvailable" DECIMAL(10,4),
    "isPriorityElement" BOOLEAN NOT NULL DEFAULT false,
    "subminimumFraction" DECIMAL(9,6),
    "priorityRule" JSONB,
    "configurationStatus" TEXT NOT NULL DEFAULT 'REGULATORY_CONFIGURATION_REQUIRED',

    CONSTRAINT "ScorecardElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardIndicator" (
    "id" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "ScorecardIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationRule" (
    "id" TEXT NOT NULL,
    "regulatoryVersionId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "indicatorCode" TEXT NOT NULL,
    "formulaType" "FormulaType" NOT NULL,
    "parameters" JSONB NOT NULL,
    "weighting" DECIMAL(10,4),
    "cap" DECIMAL(10,4),
    "bonusRule" JSONB,
    "roundingMethod" "RoundingMethod" NOT NULL DEFAULT 'NONE',
    "configurationStatus" TEXT NOT NULL DEFAULT 'REGULATORY_CONFIGURATION_REQUIRED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalculationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationRuleProvision" (
    "calculationRuleId" TEXT NOT NULL,
    "provisionId" TEXT NOT NULL,

    CONSTRAINT "CalculationRuleProvision_pkey" PRIMARY KEY ("calculationRuleId","provisionId")
);

-- CreateTable
CREATE TABLE "RecognitionTable" (
    "id" TEXT NOT NULL,
    "regulatoryVersionId" TEXT NOT NULL,
    "bands" JSONB NOT NULL,
    "discountPolicy" JSONB,
    "configurationStatus" TEXT NOT NULL DEFAULT 'REGULATORY_CONFIGURATION_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecognitionTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityClassificationRule" (
    "id" TEXT NOT NULL,
    "regulatoryVersionId" TEXT NOT NULL,
    "sectorCode" TEXT,
    "thresholds" JSONB NOT NULL,
    "configurationStatus" TEXT NOT NULL DEFAULT 'REGULATORY_CONFIGURATION_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipStructure" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "asAtDate" DATE NOT NULL,
    "tracingGraph" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnershipStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shareholder" (
    "id" TEXT NOT NULL,
    "ownershipStructureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "holderType" TEXT NOT NULL,
    "votingRights" DECIMAL(9,6),
    "economicInterest" DECIMAL(9,6),
    "blackStatusEvidenced" BOOLEAN,
    "blackWomanEvidenced" BOOLEAN,
    "parentShareholderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shareholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "employeeRef" TEXT NOT NULL,
    "maskedIdNumber" TEXT,
    "occupationalLevel" TEXT,
    "isBoardMember" BOOLEAN NOT NULL DEFAULT false,
    "isExecutive" BOOLEAN NOT NULL DEFAULT false,
    "race" TEXT,
    "gender" TEXT,
    "disability" BOOLEAN,
    "demographicsEvidenced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "learnerRef" TEXT NOT NULL,
    "programme" TEXT NOT NULL,
    "category" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "claimedAmount" DECIMAL(20,2),
    "verifiedAmount" DECIMAL(20,2),
    "status" "EvidenceStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "certificateType" TEXT,
    "certificateLevel" TEXT,
    "certificateIssuer" TEXT,
    "certificateIssueDate" DATE,
    "certificateExpiryDate" DATE,
    "blackOwnership" DECIMAL(9,6),
    "blackWomenOwnership" DECIMAL(9,6),
    "category" TEXT,
    "recognitionPercent" DECIMAL(9,6),
    "status" "EvidenceStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementTransaction" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT,
    "transactionDate" DATE,
    "amount" DECIMAL(20,2) NOT NULL,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentBeneficiary" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "programme" "ScorecardElementCode" NOT NULL,
    "blackOwnership" DECIMAL(9,6),
    "turnover" DECIMAL(20,2),
    "isSupplier" BOOLEAN,
    "eligibility" "EvidenceStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentContribution" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "contributionType" TEXT NOT NULL,
    "contributionDate" DATE,
    "claimedAmount" DECIMAL(20,2) NOT NULL,
    "recognitionFraction" DECIMAL(9,6),
    "verifiedAmount" DECIMAL(20,2),
    "status" "EvidenceStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SEDContribution" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "purpose" TEXT,
    "contributionDate" DATE,
    "claimedAmount" DECIMAL(20,2) NOT NULL,
    "qualifyingBeneficiaryFraction" DECIMAL(9,6),
    "verifiedAmount" DECIMAL(20,2),
    "status" "EvidenceStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SEDContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "output" JSONB,
    "validationErrors" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationFinding" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "findingType" TEXT NOT NULL,
    "element" "ScorecardElementCode",
    "indicatorCode" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "claimedValue" DECIMAL(20,2),
    "verifiedValue" DECIMAL(20,2),
    "confidence" "Confidence" NOT NULL DEFAULT 'UNVERIFIED',
    "regulatoryProvisionIds" TEXT[],
    "isVerificationRisk" BOOLEAN NOT NULL DEFAULT false,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationQuery" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "queryNumber" INTEGER NOT NULL,
    "element" "ScorecardElementCode",
    "indicatorCode" TEXT,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceReviewed" TEXT,
    "evidenceRequested" TEXT NOT NULL,
    "scoreImpact" TEXT,
    "priority" "QueryPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "internalNote" TEXT,
    "shareInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "responseDate" TIMESTAMP(3),
    "reviewResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryResponse" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryResponseDocument" (
    "queryResponseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,

    CONSTRAINT "QueryResponseDocument_pkey" PRIMARY KEY ("queryResponseId","documentId")
);

-- CreateTable
CREATE TABLE "CalculationInput" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "indicatorCode" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "clientClaim" DECIMAL(20,4),
    "verifiedValue" DECIMAL(20,4),
    "unverifiedValue" DECIMAL(20,4),
    "potentialValue" DECIMAL(20,4),
    "confidence" "Confidence" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalculationInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationResult" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "scorecardId" TEXT,
    "calculationRuleId" TEXT NOT NULL,
    "indicatorCode" TEXT NOT NULL,
    "status" "CalculationStatus" NOT NULL,
    "trace" JSONB NOT NULL,
    "points" DECIMAL(10,4),
    "bonusPoints" DECIMAL(10,4),
    "confidence" "Confidence" NOT NULL DEFAULT 'UNVERIFIED',
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalculationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROVISIONAL',
    "isScenario" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardResult" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "totalPoints" DECIMAL(10,4),
    "levelBeforeDiscount" TEXT,
    "levelAfterDiscount" TEXT,
    "recognitionPercent" DECIMAL(9,6),
    "priorityResults" JSONB NOT NULL,
    "resultLabel" TEXT NOT NULL,
    "lowConfidenceAreas" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScorecardResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Override" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "overrideType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "aiValue" JSONB,
    "overrideValue" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalReview" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "TechnicalReviewDecision" NOT NULL DEFAULT 'PENDING',
    "aiComparison" JSONB,
    "comments" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewFinding" (
    "id" TEXT NOT NULL,
    "technicalReviewId" TEXT NOT NULL,
    "element" "ScorecardElementCode",
    "indicatorCode" TEXT,
    "description" TEXT NOT NULL,
    "isMaterial" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationSnapshot" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "milestone" "SnapshotMilestone" NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "snapshotId" TEXT,
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "organisationId" TEXT,
    "engagementId" TEXT,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "User"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_organisationId_role_permission_key" ON "RolePermission"("organisationId", "role", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "ClientUserAccess_userId_clientId_key" ON "ClientUserAccess"("userId", "clientId");

-- CreateIndex
CREATE INDEX "Client_organisationId_idx" ON "Client"("organisationId");

-- CreateIndex
CREATE INDEX "MeasuredEntity_clientId_idx" ON "MeasuredEntity"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationEngagement_reference_key" ON "VerificationEngagement"("reference");

-- CreateIndex
CREATE INDEX "VerificationEngagement_clientId_idx" ON "VerificationEngagement"("clientId");

-- CreateIndex
CREATE INDEX "VerificationEngagement_status_idx" ON "VerificationEngagement"("status");

-- CreateIndex
CREATE INDEX "MeasurementPeriod_engagementId_idx" ON "MeasurementPeriod"("engagementId");

-- CreateIndex
CREATE INDEX "Document_engagementId_idx" ON "Document"("engagementId");

-- CreateIndex
CREATE INDEX "Document_documentClass_idx" ON "Document"("documentClass");

-- CreateIndex
CREATE INDEX "DocumentVersion_sha256_idx" ON "DocumentVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentExtraction_cacheKey_key" ON "DocumentExtraction"("cacheKey");

-- CreateIndex
CREATE INDEX "DocumentExtraction_documentVersionId_idx" ON "DocumentExtraction"("documentVersionId");

-- CreateIndex
CREATE INDEX "EvidenceItem_engagementId_element_idx" ON "EvidenceItem"("engagementId", "element");

-- CreateIndex
CREATE INDEX "EvidenceItem_documentVersionId_idx" ON "EvidenceItem"("documentVersionId");

-- CreateIndex
CREATE INDEX "EvidenceLink_targetType_targetId_idx" ON "EvidenceLink"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceLink_evidenceItemId_targetType_targetId_key" ON "EvidenceLink"("evidenceItemId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryFramework_code_key" ON "RegulatoryFramework"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SectorCode_code_key" ON "SectorCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryVersion_supersedesId_key" ON "RegulatoryVersion"("supersedesId");

-- CreateIndex
CREATE INDEX "RegulatoryVersion_frameworkId_validFrom_idx" ON "RegulatoryVersion"("frameworkId", "validFrom");

-- CreateIndex
CREATE INDEX "RegulatoryProvision_element_indicatorCode_idx" ON "RegulatoryProvision"("element", "indicatorCode");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryProvision_documentId_reference_key" ON "RegulatoryProvision"("documentId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardTemplate_regulatoryVersionId_code_key" ON "ScorecardTemplate"("regulatoryVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardElement_templateId_element_key" ON "ScorecardElement"("templateId", "element");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardIndicator_elementId_code_key" ON "ScorecardIndicator"("elementId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CalculationRule_regulatoryVersionId_indicatorCode_key" ON "CalculationRule"("regulatoryVersionId", "indicatorCode");

-- CreateIndex
CREATE UNIQUE INDEX "RecognitionTable_regulatoryVersionId_key" ON "RecognitionTable"("regulatoryVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityClassificationRule_regulatoryVersionId_sectorCode_key" ON "EntityClassificationRule"("regulatoryVersionId", "sectorCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_engagementId_employeeRef_key" ON "Employee"("engagementId", "employeeRef");

-- CreateIndex
CREATE INDEX "Supplier_engagementId_idx" ON "Supplier"("engagementId");

-- CreateIndex
CREATE INDEX "AgentRun_engagementId_agentType_idx" ON "AgentRun"("engagementId", "agentType");

-- CreateIndex
CREATE INDEX "AgentRun_agentType_inputHash_idx" ON "AgentRun"("agentType", "inputHash");

-- CreateIndex
CREATE INDEX "VerificationFinding_engagementId_element_idx" ON "VerificationFinding"("engagementId", "element");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationQuery_engagementId_queryNumber_key" ON "VerificationQuery"("engagementId", "queryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CalculationInput_engagementId_indicatorCode_inputKey_key" ON "CalculationInput"("engagementId", "indicatorCode", "inputKey");

-- CreateIndex
CREATE INDEX "CalculationResult_engagementId_indicatorCode_idx" ON "CalculationResult"("engagementId", "indicatorCode");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardResult_scorecardId_key" ON "ScorecardResult"("scorecardId");

-- CreateIndex
CREATE INDEX "Override_targetType_targetId_idx" ON "Override"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "VerificationSnapshot_engagementId_createdAt_idx" ON "VerificationSnapshot"("engagementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_sequence_key" ON "AuditEvent"("sequence");

-- CreateIndex
CREATE INDEX "AuditEvent_engagementId_createdAt_idx" ON "AuditEvent"("engagementId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUserAccess" ADD CONSTRAINT "ClientUserAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUserAccess" ADD CONSTRAINT "ClientUserAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasuredEntity" ADD CONSTRAINT "MeasuredEntity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEngagement" ADD CONSTRAINT "VerificationEngagement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEngagement" ADD CONSTRAINT "VerificationEngagement_measuredEntityId_fkey" FOREIGN KEY ("measuredEntityId") REFERENCES "MeasuredEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEngagement" ADD CONSTRAINT "VerificationEngagement_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEngagement" ADD CONSTRAINT "VerificationEngagement_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEngagement" ADD CONSTRAINT "VerificationEngagement_signatoryId_fkey" FOREIGN KEY ("signatoryId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEngagement" ADD CONSTRAINT "VerificationEngagement_regulatoryVersionId_fkey" FOREIGN KEY ("regulatoryVersionId") REFERENCES "RegulatoryVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEngagement" ADD CONSTRAINT "VerificationEngagement_scorecardTemplateId_fkey" FOREIGN KEY ("scorecardTemplateId") REFERENCES "ScorecardTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementPeriod" ADD CONSTRAINT "MeasurementPeriod_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_classifiedById_fkey" FOREIGN KEY ("classifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceArchiveId_fkey" FOREIGN KEY ("sourceArchiveId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryFramework" ADD CONSTRAINT "RegulatoryFramework_sectorCodeId_fkey" FOREIGN KEY ("sectorCodeId") REFERENCES "SectorCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryDocument" ADD CONSTRAINT "RegulatoryDocument_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "RegulatoryFramework"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryDocument" ADD CONSTRAINT "RegulatoryDocument_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "RegulatoryDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryVersion" ADD CONSTRAINT "RegulatoryVersion_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "RegulatoryFramework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryVersion" ADD CONSTRAINT "RegulatoryVersion_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "RegulatoryVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryVersion" ADD CONSTRAINT "RegulatoryVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryVersionDocument" ADD CONSTRAINT "RegulatoryVersionDocument_regulatoryVersionId_fkey" FOREIGN KEY ("regulatoryVersionId") REFERENCES "RegulatoryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryVersionDocument" ADD CONSTRAINT "RegulatoryVersionDocument_regulatoryDocumentId_fkey" FOREIGN KEY ("regulatoryDocumentId") REFERENCES "RegulatoryDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryProvision" ADD CONSTRAINT "RegulatoryProvision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "RegulatoryDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardTemplate" ADD CONSTRAINT "ScorecardTemplate_regulatoryVersionId_fkey" FOREIGN KEY ("regulatoryVersionId") REFERENCES "RegulatoryVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardElement" ADD CONSTRAINT "ScorecardElement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScorecardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardIndicator" ADD CONSTRAINT "ScorecardIndicator_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "ScorecardElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRule" ADD CONSTRAINT "CalculationRule_regulatoryVersionId_fkey" FOREIGN KEY ("regulatoryVersionId") REFERENCES "RegulatoryVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRule" ADD CONSTRAINT "CalculationRule_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "ScorecardIndicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRuleProvision" ADD CONSTRAINT "CalculationRuleProvision_calculationRuleId_fkey" FOREIGN KEY ("calculationRuleId") REFERENCES "CalculationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRuleProvision" ADD CONSTRAINT "CalculationRuleProvision_provisionId_fkey" FOREIGN KEY ("provisionId") REFERENCES "RegulatoryProvision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionTable" ADD CONSTRAINT "RecognitionTable_regulatoryVersionId_fkey" FOREIGN KEY ("regulatoryVersionId") REFERENCES "RegulatoryVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityClassificationRule" ADD CONSTRAINT "EntityClassificationRule_regulatoryVersionId_fkey" FOREIGN KEY ("regulatoryVersionId") REFERENCES "RegulatoryVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipStructure" ADD CONSTRAINT "OwnershipStructure_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shareholder" ADD CONSTRAINT "Shareholder_ownershipStructureId_fkey" FOREIGN KEY ("ownershipStructureId") REFERENCES "OwnershipStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shareholder" ADD CONSTRAINT "Shareholder_parentShareholderId_fkey" FOREIGN KEY ("parentShareholderId") REFERENCES "Shareholder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementTransaction" ADD CONSTRAINT "ProcurementTransaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentBeneficiary" ADD CONSTRAINT "DevelopmentBeneficiary_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentContribution" ADD CONSTRAINT "DevelopmentContribution_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "DevelopmentBeneficiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SEDContribution" ADD CONSTRAINT "SEDContribution_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationFinding" ADD CONSTRAINT "VerificationFinding_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationFinding" ADD CONSTRAINT "VerificationFinding_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQuery" ADD CONSTRAINT "VerificationQuery_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQuery" ADD CONSTRAINT "VerificationQuery_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryResponse" ADD CONSTRAINT "QueryResponse_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "VerificationQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryResponse" ADD CONSTRAINT "QueryResponse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryResponseDocument" ADD CONSTRAINT "QueryResponseDocument_queryResponseId_fkey" FOREIGN KEY ("queryResponseId") REFERENCES "QueryResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryResponseDocument" ADD CONSTRAINT "QueryResponseDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationInput" ADD CONSTRAINT "CalculationInput_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_calculationRuleId_fkey" FOREIGN KEY ("calculationRuleId") REFERENCES "CalculationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScorecardTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardResult" ADD CONSTRAINT "ScorecardResult_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Override" ADD CONSTRAINT "Override_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Override" ADD CONSTRAINT "Override_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalReview" ADD CONSTRAINT "TechnicalReview_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalReview" ADD CONSTRAINT "TechnicalReview_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VerificationSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalReview" ADD CONSTRAINT "TechnicalReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewFinding" ADD CONSTRAINT "ReviewFinding_technicalReviewId_fkey" FOREIGN KEY ("technicalReviewId") REFERENCES "TechnicalReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationSnapshot" ADD CONSTRAINT "VerificationSnapshot_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "VerificationEngagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
