-- FEMS initial schema

-- Generated from prisma/schema.prisma (DMMF) — MySQL 5.7+/8.x compatible.

-- Apply with: npm run db:migrate



-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(100) NOT NULL,
    `lastName` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `avatarUrl` VARCHAR(512) NULL,
    `jobTitle` VARCHAR(120) NULL,
    `status` ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `emailVerifiedAt` DATETIME(3) NULL,
    `phoneVerifiedAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `failedLoginCount` INT NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `preferredLanguage` VARCHAR(8) NOT NULL DEFAULT 'fr',
    `companyId` VARCHAR(36) NULL,
    `createdById` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_companyId_idx`(`companyId`),
    INDEX `users_status_idx`(`status`),
    INDEX `users_deletedAt_idx`(`deletedAt`),
    INDEX `users_createdById_idx`(`createdById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `isSystem` TINYINT(1) NOT NULL DEFAULT 1,
    `level` INT NOT NULL DEFAULT 10,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `roles_name_key`(`name`),
    INDEX `roles_level_idx`(`level`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(96) NOT NULL,
    `module` VARCHAR(48) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `permissions_code_key`(`code`),
    INDEX `permissions_module_idx`(`module`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(36) NOT NULL,
    `permissionId` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`roleId`, `permissionId`),
    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    INDEX `role_permissions_roleId_idx`(`roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `user_roles` (
    `userId` VARCHAR(36) NOT NULL,
    `roleId` VARCHAR(36) NOT NULL,
    `assignedById` VARCHAR(36) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    PRIMARY KEY (`userId`, `roleId`),
    INDEX `user_roles_roleId_idx`(`roleId`),
    INDEX `user_roles_assignedById_idx`(`assignedById`),
    INDEX `user_roles_userId_idx`(`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `family` VARCHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedByTokenId` VARCHAR(36) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    INDEX `refresh_tokens_family_idx`(`family`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `password_reset_tokens_tokenHash_key`(`tokenHash`),
    INDEX `password_reset_tokens_userId_idx`(`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `email_verification_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `email_verification_tokens_tokenHash_key`(`tokenHash`),
    INDEX `email_verification_tokens_userId_idx`(`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `device_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(16) NOT NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `device_tokens_token_key`(`token`),
    INDEX `device_tokens_userId_idx`(`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(36) NOT NULL,
    `actorId` VARCHAR(36) NULL,
    `actorEmail` VARCHAR(191) NULL,
    `action` ENUM('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'REGISTER', 'PASSWORD_RESET', 'TOKEN_REFRESH', 'CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'PERMIT_STATUS_CHANGE', 'PAYMENT_INITIATED', 'PAYMENT_VERIFIED', 'PAYMENT_FAILED', 'FILE_UPLOAD', 'AI_ANALYSIS', 'AI_ALERT_REVIEW', 'ASSISTANT_QUERY', 'EXPORT', 'SETTINGS_CHANGE', 'ROLE_ASSIGNED', 'ACCOUNT_STATUS_CHANGE') NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `description` VARCHAR(500) NULL,
    `beforeJson` LONGTEXT NULL,
    `afterJson` LONGTEXT NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_actorId_idx`(`actorId`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `system_settings` (
    `id` VARCHAR(36) NOT NULL,
    `key` VARCHAR(96) NOT NULL,
    `value` LONGTEXT NOT NULL,
    `category` ENUM('GENERAL', 'NOTIFICATION', 'AI', 'GIS', 'PAYMENT', 'SECURITY', 'STORAGE') NOT NULL DEFAULT 'GENERAL',
    `valueType` ENUM('STRING', 'NUMBER', 'BOOLEAN', 'JSON') NOT NULL DEFAULT 'STRING',
    `description` VARCHAR(255) NULL,
    `isSecret` TINYINT(1) NOT NULL DEFAULT 0,
    `updatedById` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `system_settings_key_key`(`key`),
    INDEX `system_settings_category_idx`(`category`),
    INDEX `system_settings_updatedById_idx`(`updatedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `companies` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `registrationNumber` VARCHAR(64) NOT NULL,
    `taxNumber` VARCHAR(64) NULL,
    `type` ENUM('LOGGING_COMPANY', 'TIMBER_TRADER', 'SAWMILL', 'ARTISANAL', 'COOPERATIVE', 'WOOD_PROCESSING', 'OTHER') NOT NULL,
    `status` ENUM('PENDING', 'VERIFIED', 'SUSPENDED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `alternatePhone` VARCHAR(32) NULL,
    `addressLine` VARCHAR(255) NOT NULL,
    `city` VARCHAR(96) NOT NULL,
    `region` VARCHAR(96) NOT NULL,
    `country` VARCHAR(96) NOT NULL DEFAULT 'Cameroun',
    `website` VARCHAR(191) NULL,
    `logoUrl` VARCHAR(512) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `employeeCount` INT NULL,
    `description` TEXT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedById` VARCHAR(36) NULL,
    `rejectionReason` VARCHAR(500) NULL,
    `ownerId` VARCHAR(36) NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `companies_name_key`(`name`),
    UNIQUE INDEX `companies_registrationNumber_key`(`registrationNumber`),
    UNIQUE INDEX `companies_taxNumber_key`(`taxNumber`),
    INDEX `companies_status_idx`(`status`),
    INDEX `companies_type_idx`(`type`),
    INDEX `companies_region_idx`(`region`),
    INDEX `companies_deletedAt_idx`(`deletedAt`),
    INDEX `companies_ownerId_idx`(`ownerId`),
    INDEX `companies_verifiedById_idx`(`verifiedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `company_documents` (
    `id` VARCHAR(36) NOT NULL,
    `companyId` VARCHAR(36) NOT NULL,
    `type` ENUM('COMPANY_REGISTRATION', 'TAX_CLEARANCE', 'ENVIRONMENTAL_IMPACT_ASSESSMENT', 'MANAGEMENT_PLAN', 'LAND_TITLE', 'IDENTITY_DOCUMENT', 'EXPLOITATION_LICENCE', 'TRANSPORT_PERMIT', 'OTHER') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `fileUrl` VARCHAR(512) NOT NULL,
    `fileKey` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `sizeBytes` INT NOT NULL,
    `checksum` VARCHAR(64) NULL,
    `isVerified` TINYINT(1) NOT NULL DEFAULT 0,
    `verifiedById` VARCHAR(36) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `expiresAt` DATETIME(3) NULL,
    `uploadedById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `company_documents_companyId_type_idx`(`companyId`, `type`),
    INDEX `company_documents_uploadedById_idx`(`uploadedById`),
    INDEX `company_documents_verifiedById_idx`(`verifiedById`),
    INDEX `company_documents_deletedAt_idx`(`deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `forests` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `type` ENUM('PRODUCTION', 'PROTECTION', 'COMMUNITY', 'REGENERATION', 'PLANTATION', 'MIXED') NOT NULL,
    `status` ENUM('ACTIVE', 'UNDER_MANAGEMENT', 'DEGRADED', 'PROTECTED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `region` VARCHAR(96) NOT NULL,
    `division` VARCHAR(96) NULL,
    `subdivision` VARCHAR(96) NULL,
    `totalAreaHa` DECIMAL(14, 2) NOT NULL,
    `exploitableAreaHa` DECIMAL(14, 2) NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `boundaryGeoJson` LONGTEXT NULL,
    `elevationM` INT NULL,
    `annualAllowableCutM3` DECIMAL(14, 2) NULL,
    `establishedAt` DATETIME(3) NULL,
    `lastInventoriedAt` DATETIME(3) NULL,
    `isPublic` TINYINT(1) NOT NULL DEFAULT 1,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `protectedAreaId` VARCHAR(36) NULL,
    `managedById` VARCHAR(36) NULL,
    `createdById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `forests_code_key`(`code`),
    INDEX `forests_status_idx`(`status`),
    INDEX `forests_region_idx`(`region`),
    INDEX `forests_type_idx`(`type`),
    INDEX `forests_protectedAreaId_idx`(`protectedAreaId`),
    INDEX `forests_managedById_idx`(`managedById`),
    INDEX `forests_deletedAt_idx`(`deletedAt`),
    INDEX `forests_createdById_idx`(`createdById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `forest_zones` (
    `id` VARCHAR(36) NOT NULL,
    `forestId` VARCHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `zoneType` ENUM('PRODUCTION', 'PROTECTION', 'CONSERVATION', 'COMMUNITY', 'REGENERATION', 'BUFFER', 'SACRED') NOT NULL,
    `status` ENUM('ACTIVE', 'RESTRICTED', 'EXHAUSTED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `areaHa` DECIMAL(14, 2) NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `boundaryGeoJson` LONGTEXT NULL,
    `maxAnnualYieldM3` DECIMAL(14, 2) NULL,
    `conservationPriority` INT NOT NULL DEFAULT 0,
    `isProtected` TINYINT(1) NOT NULL DEFAULT 0,
    `description` TEXT NULL,
    `lastHarvestedAt` DATETIME(3) NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `forest_zones_forestId_code_key`(`forestId`, `code`),
    INDEX `forest_zones_forestId_idx`(`forestId`),
    INDEX `forest_zones_zoneType_idx`(`zoneType`),
    INDEX `forest_zones_status_idx`(`status`),
    INDEX `forest_zones_deletedAt_idx`(`deletedAt`),
    INDEX `forest_zones_createdById_idx`(`createdById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `protected_areas` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('NATIONAL_PARK', 'WILDLIFE_RESERVE', 'FOREST_RESERVE', 'COMMUNITY_FOREST', 'BIOSPHERE_RESERVE', 'SANCTUARY', 'RAMSAR_SITE') NOT NULL,
    `status` ENUM('ACTIVE', 'UNDER_REVIEW', 'DEGRADED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `region` VARCHAR(96) NOT NULL,
    `areaHa` DECIMAL(14, 2) NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `boundaryGeoJson` LONGTEXT NULL,
    `establishedAt` DATETIME(3) NULL,
    `managingAuthority` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `biodiversityNotes` TEXT NULL,
    `encroachmentRisk` ENUM('LOW', 'MODERATE', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'LOW',
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `protected_areas_code_key`(`code`),
    INDEX `protected_areas_type_idx`(`type`),
    INDEX `protected_areas_region_idx`(`region`),
    INDEX `protected_areas_status_idx`(`status`),
    INDEX `protected_areas_deletedAt_idx`(`deletedAt`),
    INDEX `protected_areas_createdById_idx`(`createdById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `tree_species` (
    `id` VARCHAR(36) NOT NULL,
    `scientificName` VARCHAR(191) NOT NULL,
    `commonName` VARCHAR(191) NOT NULL,
    `familyName` VARCHAR(120) NULL,
    `localName` VARCHAR(120) NULL,
    `iucnStatus` VARCHAR(32) NULL,
    `isProtected` TINYINT(1) NOT NULL DEFAULT 0,
    `isCommercial` TINYINT(1) NOT NULL DEFAULT 1,
    `maxHarvestDiameterCm` DECIMAL(8, 2) NULL,
    `minRotationYears` INT NULL,
    `woodDensityKgM3` DECIMAL(8, 2) NULL,
    `description` TEXT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `tree_species_scientificName_key`(`scientificName`),
    INDEX `tree_species_isCommercial_idx`(`isCommercial`),
    INDEX `tree_species_isProtected_idx`(`isProtected`),
    INDEX `tree_species_deletedAt_idx`(`deletedAt`),
    INDEX `tree_species_createdById_idx`(`createdById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `tree_inventories` (
    `id` VARCHAR(36) NOT NULL,
    `forestId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `speciesId` VARCHAR(36) NOT NULL,
    `surveyDate` DATETIME(3) NOT NULL,
    `plotCode` VARCHAR(40) NOT NULL,
    `treesCounted` INT NOT NULL,
    `averageDiameterCm` DECIMAL(8, 2) NULL,
    `averageHeightM` DECIMAL(8, 2) NULL,
    `volumeM3` DECIMAL(14, 2) NULL,
    `densityPerHa` DECIMAL(10, 2) NULL,
    `healthStatus` ENUM('HEALTHY', 'DISEASED', 'DAMAGED', 'DEAD', 'LOGGED') NOT NULL DEFAULT 'HEALTHY',
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `notes` TEXT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `recordedById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `tree_inventories_forestId_surveyDate_idx`(`forestId`, `surveyDate`),
    INDEX `tree_inventories_zoneId_idx`(`zoneId`),
    INDEX `tree_inventories_speciesId_idx`(`speciesId`),
    INDEX `tree_inventories_recordedById_idx`(`recordedById`),
    INDEX `tree_inventories_deletedAt_idx`(`deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `exploitation_permits` (
    `id` VARCHAR(36) NOT NULL,
    `permitNumber` VARCHAR(40) NOT NULL,
    `type` ENUM('EXPLOITATION', 'TRANSPORT', 'PROCESSING', 'EXPORT', 'ARTISANAL', 'RECONNAISSANCE', 'COMMUNITY_FOREST') NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUIRED', 'REJECTED', 'APPROVED', 'PAYMENT_PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `title` VARCHAR(191) NOT NULL,
    `purpose` TEXT NULL,
    `companyId` VARCHAR(36) NOT NULL,
    `applicantId` VARCHAR(36) NOT NULL,
    `forestId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `volumeRequestedM3` DECIMAL(14, 2) NOT NULL,
    `volumeApprovedM3` DECIMAL(14, 2) NULL,
    `areaRequestedHa` DECIMAL(14, 2) NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'XAF',
    `feeAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `royaltyRatePerM3` DECIMAL(14, 2) NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewStartedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(36) NULL,
    `rejectionReason` TEXT NULL,
    `revisionNotes` TEXT NULL,
    `revisionCount` INT NOT NULL DEFAULT 0,
    `activatedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `suspensionReason` TEXT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revocationReason` TEXT NULL,
    `expiresAt` DATETIME(3) NULL,
    `previousPermitId` VARCHAR(36) NULL,
    `renewalCount` INT NOT NULL DEFAULT 0,
    `conditions` LONGTEXT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `exploitation_permits_permitNumber_key`(`permitNumber`),
    INDEX `exploitation_permits_status_idx`(`status`),
    INDEX `exploitation_permits_companyId_status_idx`(`companyId`, `status`),
    INDEX `exploitation_permits_forestId_idx`(`forestId`),
    INDEX `exploitation_permits_zoneId_idx`(`zoneId`),
    INDEX `exploitation_permits_applicantId_idx`(`applicantId`),
    INDEX `exploitation_permits_reviewedById_idx`(`reviewedById`),
    INDEX `exploitation_permits_approvedById_idx`(`approvedById`),
    INDEX `exploitation_permits_previousPermitId_idx`(`previousPermitId`),
    INDEX `exploitation_permits_endDate_idx`(`endDate`),
    INDEX `exploitation_permits_deletedAt_idx`(`deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `permit_status_history` (
    `id` VARCHAR(36) NOT NULL,
    `permitId` VARCHAR(36) NOT NULL,
    `fromStatus` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUIRED', 'REJECTED', 'APPROVED', 'PAYMENT_PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'CANCELLED') NULL,
    `toStatus` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUIRED', 'REJECTED', 'APPROVED', 'PAYMENT_PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'CANCELLED') NOT NULL,
    `changedById` VARCHAR(36) NULL,
    `reason` VARCHAR(500) NULL,
    `metadataJson` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `permit_status_history_permitId_createdAt_idx`(`permitId`, `createdAt`),
    INDEX `permit_status_history_changedById_idx`(`changedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `permit_documents` (
    `id` VARCHAR(36) NOT NULL,
    `permitId` VARCHAR(36) NOT NULL,
    `type` ENUM('COMPANY_REGISTRATION', 'TAX_CLEARANCE', 'ENVIRONMENTAL_IMPACT_ASSESSMENT', 'MANAGEMENT_PLAN', 'LAND_TITLE', 'IDENTITY_DOCUMENT', 'EXPLOITATION_LICENCE', 'TRANSPORT_PERMIT', 'OTHER') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `fileUrl` VARCHAR(512) NOT NULL,
    `fileKey` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `sizeBytes` INT NOT NULL,
    `checksum` VARCHAR(64) NULL,
    `isVerified` TINYINT(1) NOT NULL DEFAULT 0,
    `verifiedById` VARCHAR(36) NULL,
    `notes` TEXT NULL,
    `uploadedById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `permit_documents_permitId_type_idx`(`permitId`, `type`),
    INDEX `permit_documents_uploadedById_idx`(`uploadedById`),
    INDEX `permit_documents_deletedAt_idx`(`deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `exploitation_activities` (
    `id` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(40) NOT NULL,
    `permitId` VARCHAR(36) NOT NULL,
    `companyId` VARCHAR(36) NOT NULL,
    `forestId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `activityType` ENUM('TIMBER_HARVEST', 'LOG_TRANSPORT', 'SITE_CLEARING', 'PLANTING', 'FOREST_SURVEY', 'ROAD_CONSTRUCTION', 'MAINTENANCE', 'SALVAGE_LOGGING') NOT NULL,
    `status` ENUM('PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
    `plannedVolumeM3` DECIMAL(14, 2) NOT NULL,
    `harvestedVolumeM3` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `harvestedTreeCount` INT NOT NULL DEFAULT 0,
    `plannedStartDate` DATETIME(3) NOT NULL,
    `plannedEndDate` DATETIME(3) NULL,
    `actualStartDate` DATETIME(3) NULL,
    `actualEndDate` DATETIME(3) NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `locationAccuracyM` DECIMAL(8, 2) NULL,
    `gpsCapturedAt` DATETIME(3) NULL,
    `gpsSource` ENUM('DEVICE_GPS', 'MANUAL_CORRECTION', 'SYSTEM_RECORDED', 'SEED_DEMO') NOT NULL DEFAULT 'DEVICE_GPS',
    `equipmentSummary` VARCHAR(500) NULL,
    `observations` TEXT NULL,
    `speciesBreakdownJson` LONGTEXT NULL,
    `createdById` VARCHAR(36) NOT NULL,
    `assignedToId` VARCHAR(36) NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `syncStatus` ENUM('SYNCED', 'PENDING_SYNC', 'FAILED') NOT NULL DEFAULT 'SYNCED',
    `clientRef` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `exploitation_activities_reference_key`(`reference`),
    UNIQUE INDEX `exploitation_activities_clientRef_key`(`clientRef`),
    INDEX `exploitation_activities_permitId_idx`(`permitId`),
    INDEX `exploitation_activities_companyId_status_idx`(`companyId`, `status`),
    INDEX `exploitation_activities_forestId_idx`(`forestId`),
    INDEX `exploitation_activities_zoneId_idx`(`zoneId`),
    INDEX `exploitation_activities_assignedToId_idx`(`assignedToId`),
    INDEX `exploitation_activities_status_idx`(`status`),
    INDEX `exploitation_activities_plannedStartDate_idx`(`plannedStartDate`),
    INDEX `exploitation_activities_deletedAt_idx`(`deletedAt`),
    INDEX `exploitation_activities_createdById_idx`(`createdById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `equipment` (
    `id` VARCHAR(36) NOT NULL,
    `companyId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` ENUM('HARVESTER', 'CHAINSAW', 'LOGGING_TRUCK', 'TRACTOR', 'SKIDDER', 'LOG_LOADER', 'BULLDOZER', 'DRONE', 'SURVEY_EQUIPMENT', 'OTHER') NOT NULL,
    `status` ENUM('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE') NOT NULL DEFAULT 'AVAILABLE',
    `registrationNumber` VARCHAR(64) NULL,
    `serialNumber` VARCHAR(96) NULL,
    `manufacturer` VARCHAR(120) NULL,
    `model` VARCHAR(120) NULL,
    `acquiredAt` DATETIME(3) NULL,
    `lastMaintenanceAt` DATETIME(3) NULL,
    `nextMaintenanceAt` DATETIME(3) NULL,
    `capacityM3` DECIMAL(10, 2) NULL,
    `notes` TEXT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdById` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `equipment_companyId_registrationNumber_key`(`companyId`, `registrationNumber`),
    INDEX `equipment_companyId_status_idx`(`companyId`, `status`),
    INDEX `equipment_category_idx`(`category`),
    INDEX `equipment_deletedAt_idx`(`deletedAt`),
    INDEX `equipment_createdById_idx`(`createdById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `activity_equipment_usage` (
    `id` VARCHAR(36) NOT NULL,
    `activityId` VARCHAR(36) NOT NULL,
    `equipmentId` VARCHAR(36) NOT NULL,
    `operatorName` VARCHAR(191) NULL,
    `hoursUsed` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `fuelLitres` DECIMAL(10, 2) NULL,
    `notes` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `activity_equipment_usage_activityId_equipmentId_key`(`activityId`, `equipmentId`),
    INDEX `activity_equipment_usage_equipmentId_idx`(`equipmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `field_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `activityId` VARCHAR(36) NULL,
    `forestId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'ABANDONED') NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `startLatitude` DECIMAL(10, 7) NOT NULL,
    `startLongitude` DECIMAL(10, 7) NOT NULL,
    `endLatitude` DECIMAL(10, 7) NULL,
    `endLongitude` DECIMAL(10, 7) NULL,
    `startAccuracyM` DECIMAL(8, 2) NULL,
    `deviceInfoJson` LONGTEXT NULL,
    `notes` TEXT NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING_SYNC', 'FAILED') NOT NULL DEFAULT 'SYNCED',
    `clientRef` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `field_sessions_clientRef_key`(`clientRef`),
    INDEX `field_sessions_userId_status_idx`(`userId`, `status`),
    INDEX `field_sessions_activityId_idx`(`activityId`),
    INDEX `field_sessions_forestId_idx`(`forestId`),
    INDEX `field_sessions_zoneId_idx`(`zoneId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(48) NOT NULL,
    `purpose` ENUM('PERMIT_FEE', 'ROYALTY', 'ANNUAL_TAX', 'PENALTY', 'REPLANTING_BOND', 'OTHER') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `provider` ENUM('CAMPAY', 'SIMULATOR') NOT NULL DEFAULT 'CAMPAY',
    `method` ENUM('MOBILE_MONEY_MTN', 'MOBILE_MONEY_ORANGE', 'MOBILE_MONEY_AIRTEL', 'CARD', 'BANK_TRANSFER', 'CASH') NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'XAF',
    `providerReference` VARCHAR(96) NULL,
    `providerPhone` VARCHAR(32) NULL,
    `providerPayloadJson` LONGTEXT NULL,
    `receiptNumber` VARCHAR(48) NULL,
    `failureReason` VARCHAR(500) NULL,
    `initiatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `refundedAt` DATETIME(3) NULL,
    `payerId` VARCHAR(36) NOT NULL,
    `companyId` VARCHAR(36) NULL,
    `permitId` VARCHAR(36) NULL,
    `violationId` VARCHAR(36) NULL,
    `initiatedById` VARCHAR(36) NOT NULL,
    `verifiedById` VARCHAR(36) NULL,
    `notes` TEXT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `syncStatus` ENUM('SYNCED', 'PENDING_SYNC', 'FAILED') NOT NULL DEFAULT 'SYNCED',
    `clientRef` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `payments_reference_key`(`reference`),
    UNIQUE INDEX `payments_receiptNumber_key`(`receiptNumber`),
    UNIQUE INDEX `payments_clientRef_key`(`clientRef`),
    INDEX `payments_status_idx`(`status`),
    INDEX `payments_purpose_idx`(`purpose`),
    INDEX `payments_companyId_idx`(`companyId`),
    INDEX `payments_permitId_idx`(`permitId`),
    INDEX `payments_payerId_idx`(`payerId`),
    INDEX `payments_initiatedAt_idx`(`initiatedAt`),
    INDEX `payments_initiatedById_idx`(`initiatedById`),
    INDEX `payments_verifiedById_idx`(`verifiedById`),
    INDEX `payments_violationId_idx`(`violationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `inspections` (
    `id` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(40) NOT NULL,
    `type` ENUM('ROUTINE', 'COMPLIANCE', 'ENVIRONMENTAL', 'POST_ACTIVITY', 'INCIDENT', 'VERIFICATION') NOT NULL,
    `status` ENUM('SCHEDULED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `outcome` ENUM('COMPLIANT', 'MINOR_NON_COMPLIANCE', 'MAJOR_NON_COMPLIANCE', 'CRITICAL_NON_COMPLIANCE') NULL,
    `complianceScore` INT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `recommendations` TEXT NULL,
    `forestId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `protectedAreaId` VARCHAR(36) NULL,
    `companyId` VARCHAR(36) NULL,
    `permitId` VARCHAR(36) NULL,
    `activityId` VARCHAR(36) NULL,
    `inspectorId` VARCHAR(36) NOT NULL,
    `assignedById` VARCHAR(36) NULL,
    `reviewedById` VARCHAR(36) NULL,
    `scheduledFor` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `locationAccuracyM` DECIMAL(8, 2) NULL,
    `gpsCapturedAt` DATETIME(3) NULL,
    `gpsSource` ENUM('DEVICE_GPS', 'MANUAL_CORRECTION', 'SYSTEM_RECORDED', 'SEED_DEMO') NOT NULL DEFAULT 'DEVICE_GPS',
    `distanceFromTargetM` DECIMAL(10, 2) NULL,
    `verifiedHarvestedVolumeM3` DECIMAL(14, 2) NULL,
    `verifiedTreeCount` INT NULL,
    `discrepancies` TEXT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `syncStatus` ENUM('SYNCED', 'PENDING_SYNC', 'FAILED') NOT NULL DEFAULT 'SYNCED',
    `clientRef` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `inspections_reference_key`(`reference`),
    UNIQUE INDEX `inspections_clientRef_key`(`clientRef`),
    INDEX `inspections_status_scheduledFor_idx`(`status`, `scheduledFor`),
    INDEX `inspections_inspectorId_status_idx`(`inspectorId`, `status`),
    INDEX `inspections_forestId_idx`(`forestId`),
    INDEX `inspections_zoneId_idx`(`zoneId`),
    INDEX `inspections_protectedAreaId_idx`(`protectedAreaId`),
    INDEX `inspections_companyId_idx`(`companyId`),
    INDEX `inspections_permitId_idx`(`permitId`),
    INDEX `inspections_activityId_idx`(`activityId`),
    INDEX `inspections_deletedAt_idx`(`deletedAt`),
    INDEX `inspections_assignedById_idx`(`assignedById`),
    INDEX `inspections_reviewedById_idx`(`reviewedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `inspection_checklist_items` (
    `id` VARCHAR(36) NOT NULL,
    `inspectionId` VARCHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `result` ENUM('PASS', 'FAIL', 'NOT_APPLICABLE') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `notes` VARCHAR(500) NULL,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `inspection_checklist_items_inspectionId_code_key`(`inspectionId`, `code`),
    INDEX `inspection_checklist_items_inspectionId_idx`(`inspectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `field_observations` (
    `id` VARCHAR(36) NOT NULL,
    `forestId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `protectedAreaId` VARCHAR(36) NULL,
    `activityId` VARCHAR(36) NULL,
    `inspectionId` VARCHAR(36) NULL,
    `category` ENUM('TREE_CONDITION', 'WILDLIFE', 'VEGETATION_COVER', 'SOIL', 'WATER_BODY', 'ENCROACHMENT', 'ILLEGAL_LOGGING', 'INFRASTRUCTURE', 'FIRE_DAMAGE', 'WEATHER', 'INCIDENT', 'OTHER') NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'LOW',
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `locationAccuracyM` DECIMAL(8, 2) NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `gpsSource` ENUM('DEVICE_GPS', 'MANUAL_CORRECTION', 'SYSTEM_RECORDED', 'SEED_DEMO') NOT NULL DEFAULT 'DEVICE_GPS',
    `observedById` VARCHAR(36) NOT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `aiProcessedAt` DATETIME(3) NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING_SYNC', 'FAILED') NOT NULL DEFAULT 'SYNCED',
    `clientRef` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `field_observations_clientRef_key`(`clientRef`),
    INDEX `field_observations_forestId_capturedAt_idx`(`forestId`, `capturedAt`),
    INDEX `field_observations_zoneId_idx`(`zoneId`),
    INDEX `field_observations_protectedAreaId_idx`(`protectedAreaId`),
    INDEX `field_observations_activityId_idx`(`activityId`),
    INDEX `field_observations_inspectionId_idx`(`inspectionId`),
    INDEX `field_observations_category_severity_idx`(`category`, `severity`),
    INDEX `field_observations_observedById_idx`(`observedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `environmental_violations` (
    `id` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(40) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `status` ENUM('OPEN', 'UNDER_INVESTIGATION', 'CONFIRMED', 'RESOLVED', 'DISMISSED', 'ESCALATED') NOT NULL DEFAULT 'OPEN',
    `forestId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `protectedAreaId` VARCHAR(36) NULL,
    `companyId` VARCHAR(36) NULL,
    `permitId` VARCHAR(36) NULL,
    `activityId` VARCHAR(36) NULL,
    `inspectionId` VARCHAR(36) NULL,
    `observationId` VARCHAR(36) NULL,
    `aiAlertId` VARCHAR(36) NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `detectedById` VARCHAR(36) NOT NULL,
    `estimatedDamageXAF` DECIMAL(14, 2) NULL,
    `penaltyAmountXAF` DECIMAL(14, 2) NULL,
    `remediationRequired` TINYINT(1) NOT NULL DEFAULT 0,
    `remediationDeadline` DATETIME(3) NULL,
    `remediationNotes` TEXT NULL,
    `investigationNotes` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` VARCHAR(36) NULL,
    `resolutionSummary` TEXT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `environmental_violations_reference_key`(`reference`),
    INDEX `environmental_violations_status_severity_idx`(`status`, `severity`),
    INDEX `environmental_violations_forestId_idx`(`forestId`),
    INDEX `environmental_violations_zoneId_idx`(`zoneId`),
    INDEX `environmental_violations_protectedAreaId_idx`(`protectedAreaId`),
    INDEX `environmental_violations_companyId_idx`(`companyId`),
    INDEX `environmental_violations_permitId_idx`(`permitId`),
    INDEX `environmental_violations_activityId_idx`(`activityId`),
    INDEX `environmental_violations_inspectionId_idx`(`inspectionId`),
    INDEX `environmental_violations_detectedAt_idx`(`detectedAt`),
    INDEX `environmental_violations_deletedAt_idx`(`deletedAt`),
    INDEX `environmental_violations_observationId_idx`(`observationId`),
    INDEX `environmental_violations_detectedById_idx`(`detectedById`),
    INDEX `environmental_violations_resolvedById_idx`(`resolvedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `evidences` (
    `id` VARCHAR(36) NOT NULL,
    `type` ENUM('PHOTO', 'VIDEO', 'DOCUMENT', 'AUDIO', 'SIGNATURE') NOT NULL,
    `source` ENUM('DEVICE_CAMERA', 'DEVICE_GALLERY', 'FILE_UPLOAD', 'SYSTEM_GENERATED') NOT NULL DEFAULT 'FILE_UPLOAD',
    `title` VARCHAR(191) NULL,
    `caption` VARCHAR(500) NULL,
    `fileUrl` VARCHAR(512) NOT NULL,
    `fileKey` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `sizeBytes` INT NOT NULL,
    `checksum` VARCHAR(64) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `locationAccuracyM` DECIMAL(8, 2) NULL,
    `capturedAt` DATETIME(3) NULL,
    `gpsSource` ENUM('DEVICE_GPS', 'MANUAL_CORRECTION', 'SYSTEM_RECORDED', 'SEED_DEMO') NULL,
    `inspectionId` VARCHAR(36) NULL,
    `activityId` VARCHAR(36) NULL,
    `observationId` VARCHAR(36) NULL,
    `violationId` VARCHAR(36) NULL,
    `permitId` VARCHAR(36) NULL,
    `companyId` VARCHAR(36) NULL,
    `uploadedById` VARCHAR(36) NOT NULL,
    `syncStatus` ENUM('SYNCED', 'PENDING_SYNC', 'FAILED') NOT NULL DEFAULT 'SYNCED',
    `clientRef` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `evidences_clientRef_key`(`clientRef`),
    INDEX `evidences_inspectionId_idx`(`inspectionId`),
    INDEX `evidences_activityId_idx`(`activityId`),
    INDEX `evidences_observationId_idx`(`observationId`),
    INDEX `evidences_violationId_idx`(`violationId`),
    INDEX `evidences_permitId_idx`(`permitId`),
    INDEX `evidences_companyId_idx`(`companyId`),
    INDEX `evidences_uploadedById_idx`(`uploadedById`),
    INDEX `evidences_deletedAt_idx`(`deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `reports` (
    `id` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(48) NOT NULL,
    `type` ENUM('PERMITS', 'EXPLOITATION_ACTIVITIES', 'PAYMENTS', 'INSPECTIONS', 'ENVIRONMENTAL_VIOLATIONS', 'FOREST_ACTIVITIES', 'AI_ALERTS', 'COMPLIANCE_SUMMARY') NOT NULL,
    `format` ENUM('JSON', 'CSV', 'PDF') NOT NULL DEFAULT 'JSON',
    `status` ENUM('DRAFT', 'GENERATING', 'READY', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `title` VARCHAR(191) NOT NULL,
    `parametersJson` LONGTEXT NULL,
    `summaryJson` LONGTEXT NULL,
    `dateFrom` DATETIME(3) NULL,
    `dateTo` DATETIME(3) NULL,
    `forestId` VARCHAR(36) NULL,
    `zoneId` VARCHAR(36) NULL,
    `protectedAreaId` VARCHAR(36) NULL,
    `companyId` VARCHAR(36) NULL,
    `permitId` VARCHAR(36) NULL,
    `fileUrl` VARCHAR(512) NULL,
    `fileKey` VARCHAR(255) NULL,
    `sizeBytes` INT NULL,
    `generatedById` VARCHAR(36) NOT NULL,
    `generatedAt` DATETIME(3) NULL,
    `errorMessage` VARCHAR(500) NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `reports_reference_key`(`reference`),
    INDEX `reports_type_status_idx`(`type`, `status`),
    INDEX `reports_generatedById_idx`(`generatedById`),
    INDEX `reports_forestId_idx`(`forestId`),
    INDEX `reports_companyId_idx`(`companyId`),
    INDEX `reports_createdAt_idx`(`createdAt`),
    INDEX `reports_deletedAt_idx`(`deletedAt`),
    INDEX `reports_protectedAreaId_idx`(`protectedAreaId`),
    INDEX `reports_permitId_idx`(`permitId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `type` ENUM('PERMIT_SUBMITTED', 'PERMIT_APPROVED', 'PERMIT_REJECTED', 'PERMIT_REVISION_REQUIRED', 'PERMIT_ACTIVATED', 'PERMIT_SUSPENDED', 'PERMIT_REVOKED', 'PERMIT_EXPIRING', 'PERMIT_EXPIRED', 'PAYMENT_INITIATED', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'INSPECTION_ASSIGNED', 'INSPECTION_COMPLETED', 'INSPECTION_SUBMITTED', 'VIOLATION_RECORDED', 'VIOLATION_RESOLVED', 'AI_ALERT_GENERATED', 'AI_ALERT_ASSIGNED', 'AI_ALERT_RESOLVED', 'ACTIVITY_SCHEDULED', 'ACTIVITY_SUBMITTED', 'OBSERVATION_RECORDED', 'REPORT_READY', 'COMPANY_VERIFIED', 'ACCOUNT_ACTIVATED', 'SYSTEM_ANNOUNCEMENT') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `actionUrl` VARCHAR(255) NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `readAt` DATETIME(3) NULL,
    `deliveredInApp` TINYINT(1) NOT NULL DEFAULT 1,
    `deliveredPush` TINYINT(1) NOT NULL DEFAULT 0,
    `deliveredEmail` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `notifications_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `notifications_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `notifications_type_idx`(`type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `type` ENUM('PERMIT_SUBMITTED', 'PERMIT_APPROVED', 'PERMIT_REJECTED', 'PERMIT_REVISION_REQUIRED', 'PERMIT_ACTIVATED', 'PERMIT_SUSPENDED', 'PERMIT_REVOKED', 'PERMIT_EXPIRING', 'PERMIT_EXPIRED', 'PAYMENT_INITIATED', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'INSPECTION_ASSIGNED', 'INSPECTION_COMPLETED', 'INSPECTION_SUBMITTED', 'VIOLATION_RECORDED', 'VIOLATION_RESOLVED', 'AI_ALERT_GENERATED', 'AI_ALERT_ASSIGNED', 'AI_ALERT_RESOLVED', 'ACTIVITY_SCHEDULED', 'ACTIVITY_SUBMITTED', 'OBSERVATION_RECORDED', 'REPORT_READY', 'COMPANY_VERIFIED', 'ACCOUNT_ACTIVATED', 'SYSTEM_ANNOUNCEMENT') NOT NULL,
    `inAppEnabled` TINYINT(1) NOT NULL DEFAULT 1,
    `pushEnabled` TINYINT(1) NOT NULL DEFAULT 1,
    `emailEnabled` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `notification_preferences_userId_type_key`(`userId`, `type`),
    INDEX `notification_preferences_userId_idx`(`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `gis_locations` (
    `id` VARCHAR(36) NOT NULL,
    `featureType` ENUM('FOREST', 'FOREST_ZONE', 'PROTECTED_AREA', 'EXPLOITATION_ACTIVITY', 'INSPECTION', 'FIELD_OBSERVATION', 'AI_ALERT', 'ENVIRONMENTAL_VIOLATION', 'COMPANY_SITE', 'USER_CHECKIN') NOT NULL,
    `entityId` VARCHAR(36) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `elevationM` INT NULL,
    `accuracyM` DECIMAL(8, 2) NULL,
    `source` ENUM('DEVICE_GPS', 'MANUAL_CORRECTION', 'SYSTEM_RECORDED', 'SEED_DEMO') NOT NULL DEFAULT 'SYSTEM_RECORDED',
    `forestId` VARCHAR(36) NULL,
    `zoneId` VARCHAR(36) NULL,
    `protectedAreaId` VARCHAR(36) NULL,
    `activityId` VARCHAR(36) NULL,
    `inspectionId` VARCHAR(36) NULL,
    `observationId` VARCHAR(36) NULL,
    `violationId` VARCHAR(36) NULL,
    `aiAlertId` VARCHAR(36) NULL,
    `recordedById` VARCHAR(36) NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `metadataJson` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `gis_locations_featureType_entityId_idx`(`featureType`, `entityId`),
    INDEX `gis_locations_latitude_longitude_idx`(`latitude`, `longitude`),
    INDEX `gis_locations_forestId_idx`(`forestId`),
    INDEX `gis_locations_zoneId_idx`(`zoneId`),
    INDEX `gis_locations_protectedAreaId_idx`(`protectedAreaId`),
    INDEX `gis_locations_activityId_idx`(`activityId`),
    INDEX `gis_locations_inspectionId_idx`(`inspectionId`),
    INDEX `gis_locations_observationId_idx`(`observationId`),
    INDEX `gis_locations_violationId_idx`(`violationId`),
    INDEX `gis_locations_aiAlertId_idx`(`aiAlertId`),
    INDEX `gis_locations_recordedById_idx`(`recordedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `ai_analyses` (
    `id` VARCHAR(36) NOT NULL,
    `type` ENUM('RISK_ASSESSMENT', 'ANOMALY_DETECTION', 'OBSERVATION_ANALYSIS', 'INSPECTION_SUMMARY', 'COMPLIANCE_SUMMARY', 'PERMIT_REVIEW_ASSIST', 'EXPLOITATION_PATTERN') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `provider` ENUM('GEMINI', 'LOCAL_RULE_ENGINE') NOT NULL DEFAULT 'LOCAL_RULE_ENGINE',
    `model` VARCHAR(96) NULL,
    `promptText` LONGTEXT NULL,
    `responseJson` LONGTEXT NULL,
    `resultJson` LONGTEXT NULL,
    `summary` TEXT NULL,
    `riskLevel` ENUM('LOW', 'MODERATE', 'HIGH', 'CRITICAL') NULL,
    `confidence` DECIMAL(5, 4) NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `forestId` VARCHAR(36) NULL,
    `zoneId` VARCHAR(36) NULL,
    `latencyMs` INT NULL,
    `tokensUsed` INT NULL,
    `errorMessage` VARCHAR(500) NULL,
    `requestedById` VARCHAR(36) NULL,
    `reviewedById` VARCHAR(36) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    INDEX `ai_analyses_type_status_idx`(`type`, `status`),
    INDEX `ai_analyses_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `ai_analyses_forestId_idx`(`forestId`),
    INDEX `ai_analyses_requestedById_idx`(`requestedById`),
    INDEX `ai_analyses_createdAt_idx`(`createdAt`),
    INDEX `ai_analyses_reviewedById_idx`(`reviewedById`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `ai_alerts` (
    `id` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(48) NOT NULL,
    `type` ENUM('DEFORESTATION_RISK', 'OVER_HARVESTING', 'PERMIT_VIOLATION', 'UNAUTHORIZED_ACTIVITY', 'ENVIRONMENTAL_HAZARD', 'PROTECTED_AREA_ENCROACHMENT', 'OPERATIONAL_ANOMALY', 'DOCUMENT_ANOMALY', 'PAYMENT_ANOMALY', 'FIELD_REPORT_ANOMALY') NOT NULL,
    `status` ENUM('NEW', 'REVIEWING', 'CONFIRMED', 'DISMISSED', 'RESOLVED') NOT NULL DEFAULT 'NEW',
    `riskLevel` ENUM('LOW', 'MODERATE', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'LOW',
    `confidence` DECIMAL(5, 4) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `reasoning` TEXT NULL,
    `detector` ENUM('GEMINI', 'LOCAL_RULE_ENGINE') NOT NULL DEFAULT 'LOCAL_RULE_ENGINE',
    `analysisId` VARCHAR(36) NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `forestId` VARCHAR(36) NULL,
    `zoneId` VARCHAR(36) NULL,
    `protectedAreaId` VARCHAR(36) NULL,
    `companyId` VARCHAR(36) NULL,
    `permitId` VARCHAR(36) NULL,
    `activityId` VARCHAR(36) NULL,
    `inspectionId` VARCHAR(36) NULL,
    `observationId` VARCHAR(36) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedById` VARCHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNotes` TEXT NULL,
    `resolutionAction` VARCHAR(500) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `violationId` VARCHAR(36) NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `ai_alerts_reference_key`(`reference`),
    INDEX `ai_alerts_status_riskLevel_idx`(`status`, `riskLevel`),
    INDEX `ai_alerts_type_idx`(`type`),
    INDEX `ai_alerts_forestId_idx`(`forestId`),
    INDEX `ai_alerts_zoneId_idx`(`zoneId`),
    INDEX `ai_alerts_protectedAreaId_idx`(`protectedAreaId`),
    INDEX `ai_alerts_companyId_idx`(`companyId`),
    INDEX `ai_alerts_permitId_idx`(`permitId`),
    INDEX `ai_alerts_activityId_idx`(`activityId`),
    INDEX `ai_alerts_inspectionId_idx`(`inspectionId`),
    INDEX `ai_alerts_observationId_idx`(`observationId`),
    INDEX `ai_alerts_reviewedById_idx`(`reviewedById`),
    INDEX `ai_alerts_detectedAt_idx`(`detectedAt`),
    INDEX `ai_alerts_analysisId_idx`(`analysisId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `ai_conversations` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `title` VARCHAR(191) NULL,
    `contextJson` LONGTEXT NULL,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    INDEX `ai_conversations_userId_lastMessageAt_idx`(`userId`, `lastMessageAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- CreateTable
CREATE TABLE `ai_messages` (
    `id` VARCHAR(36) NOT NULL,
    `conversationId` VARCHAR(36) NOT NULL,
    `role` ENUM('USER', 'ASSISTANT', 'SYSTEM', 'ERROR') NOT NULL,
    `content` LONGTEXT NOT NULL,
    `provider` ENUM('GEMINI', 'LOCAL_RULE_ENGINE') NULL,
    `model` VARCHAR(96) NULL,
    `intentJson` LONGTEXT NULL,
    `dataRefsJson` LONGTEXT NULL,
    `latencyMs` INT NULL,
    `tokensUsed` INT NULL,
    `errorMessage` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `ai_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;



-- AddForeignKey

ALTER TABLE `users` ADD CONSTRAINT `users_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `users` ADD CONSTRAINT `users_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `device_tokens` ADD CONSTRAINT `device_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `companies` ADD CONSTRAINT `companies_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `companies` ADD CONSTRAINT `companies_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `company_documents` ADD CONSTRAINT `company_documents_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `company_documents` ADD CONSTRAINT `company_documents_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `company_documents` ADD CONSTRAINT `company_documents_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `forests` ADD CONSTRAINT `forests_protectedAreaId_fkey` FOREIGN KEY (`protectedAreaId`) REFERENCES `protected_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `forests` ADD CONSTRAINT `forests_managedById_fkey` FOREIGN KEY (`managedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `forests` ADD CONSTRAINT `forests_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `forest_zones` ADD CONSTRAINT `forest_zones_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `forest_zones` ADD CONSTRAINT `forest_zones_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `protected_areas` ADD CONSTRAINT `protected_areas_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `tree_species` ADD CONSTRAINT `tree_species_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `tree_inventories` ADD CONSTRAINT `tree_inventories_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `tree_inventories` ADD CONSTRAINT `tree_inventories_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `tree_inventories` ADD CONSTRAINT `tree_inventories_speciesId_fkey` FOREIGN KEY (`speciesId`) REFERENCES `tree_species`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `tree_inventories` ADD CONSTRAINT `tree_inventories_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_permits` ADD CONSTRAINT `exploitation_permits_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_permits` ADD CONSTRAINT `exploitation_permits_applicantId_fkey` FOREIGN KEY (`applicantId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_permits` ADD CONSTRAINT `exploitation_permits_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_permits` ADD CONSTRAINT `exploitation_permits_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `exploitation_permits` ADD CONSTRAINT `exploitation_permits_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `exploitation_permits` ADD CONSTRAINT `exploitation_permits_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `exploitation_permits` ADD CONSTRAINT `exploitation_permits_previousPermitId_fkey` FOREIGN KEY (`previousPermitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `permit_status_history` ADD CONSTRAINT `permit_status_history_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `permit_status_history` ADD CONSTRAINT `permit_status_history_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `permit_documents` ADD CONSTRAINT `permit_documents_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `permit_documents` ADD CONSTRAINT `permit_documents_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_activities` ADD CONSTRAINT `exploitation_activities_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_activities` ADD CONSTRAINT `exploitation_activities_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_activities` ADD CONSTRAINT `exploitation_activities_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_activities` ADD CONSTRAINT `exploitation_activities_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `exploitation_activities` ADD CONSTRAINT `exploitation_activities_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exploitation_activities` ADD CONSTRAINT `exploitation_activities_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `equipment` ADD CONSTRAINT `equipment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `equipment` ADD CONSTRAINT `equipment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `activity_equipment_usage` ADD CONSTRAINT `activity_equipment_usage_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `activity_equipment_usage` ADD CONSTRAINT `activity_equipment_usage_equipmentId_fkey` FOREIGN KEY (`equipmentId`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `field_sessions` ADD CONSTRAINT `field_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `field_sessions` ADD CONSTRAINT `field_sessions_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `field_sessions` ADD CONSTRAINT `field_sessions_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `field_sessions` ADD CONSTRAINT `field_sessions_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `payments_payerId_fkey` FOREIGN KEY (`payerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `payments_initiatedById_fkey` FOREIGN KEY (`initiatedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `payments_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `payments_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `payments_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `payments_violationId_fkey` FOREIGN KEY (`violationId`) REFERENCES `environmental_violations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_protectedAreaId_fkey` FOREIGN KEY (`protectedAreaId`) REFERENCES `protected_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_inspectorId_fkey` FOREIGN KEY (`inspectorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspections` ADD CONSTRAINT `inspections_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inspection_checklist_items` ADD CONSTRAINT `inspection_checklist_items_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `field_observations` ADD CONSTRAINT `field_observations_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `field_observations` ADD CONSTRAINT `field_observations_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `field_observations` ADD CONSTRAINT `field_observations_protectedAreaId_fkey` FOREIGN KEY (`protectedAreaId`) REFERENCES `protected_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `field_observations` ADD CONSTRAINT `field_observations_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `field_observations` ADD CONSTRAINT `field_observations_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `field_observations` ADD CONSTRAINT `field_observations_observedById_fkey` FOREIGN KEY (`observedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_protectedAreaId_fkey` FOREIGN KEY (`protectedAreaId`) REFERENCES `protected_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_observationId_fkey` FOREIGN KEY (`observationId`) REFERENCES `field_observations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_detectedById_fkey` FOREIGN KEY (`detectedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `environmental_violations` ADD CONSTRAINT `environmental_violations_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `evidences` ADD CONSTRAINT `evidences_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evidences` ADD CONSTRAINT `evidences_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evidences` ADD CONSTRAINT `evidences_observationId_fkey` FOREIGN KEY (`observationId`) REFERENCES `field_observations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evidences` ADD CONSTRAINT `evidences_violationId_fkey` FOREIGN KEY (`violationId`) REFERENCES `environmental_violations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evidences` ADD CONSTRAINT `evidences_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evidences` ADD CONSTRAINT `evidences_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `evidences` ADD CONSTRAINT `evidences_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `reports` ADD CONSTRAINT `reports_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `reports` ADD CONSTRAINT `reports_protectedAreaId_fkey` FOREIGN KEY (`protectedAreaId`) REFERENCES `protected_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `reports` ADD CONSTRAINT `reports_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `reports` ADD CONSTRAINT `reports_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `reports` ADD CONSTRAINT `reports_generatedById_fkey` FOREIGN KEY (`generatedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_protectedAreaId_fkey` FOREIGN KEY (`protectedAreaId`) REFERENCES `protected_areas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_observationId_fkey` FOREIGN KEY (`observationId`) REFERENCES `field_observations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_violationId_fkey` FOREIGN KEY (`violationId`) REFERENCES `environmental_violations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_aiAlertId_fkey` FOREIGN KEY (`aiAlertId`) REFERENCES `ai_alerts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `gis_locations` ADD CONSTRAINT `gis_locations_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_analyses` ADD CONSTRAINT `ai_analyses_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_analyses` ADD CONSTRAINT `ai_analyses_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_analysisId_fkey` FOREIGN KEY (`analysisId`) REFERENCES `ai_analyses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_forestId_fkey` FOREIGN KEY (`forestId`) REFERENCES `forests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `forest_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_protectedAreaId_fkey` FOREIGN KEY (`protectedAreaId`) REFERENCES `protected_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_permitId_fkey` FOREIGN KEY (`permitId`) REFERENCES `exploitation_permits`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `exploitation_activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `inspections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_observationId_fkey` FOREIGN KEY (`observationId`) REFERENCES `field_observations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_alerts` ADD CONSTRAINT `ai_alerts_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

