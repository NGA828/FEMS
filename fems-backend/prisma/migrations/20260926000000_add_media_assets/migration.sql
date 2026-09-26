-- Add seeded, database-resident media (forest/protected-area/species imagery,
-- landing hero frames and the brand mark) served by GET /api/v1/media.

-- CreateTable
CREATE TABLE `media_assets` (
    `id` VARCHAR(36) NOT NULL,
    `ownerType` ENUM('FOREST', 'PROTECTED_AREA', 'TREE_SPECIES', 'HERO', 'BRAND') NOT NULL,
    `ownerId` VARCHAR(36) NULL,
    `role` ENUM('COVER', 'GALLERY', 'HERO', 'LOGO') NOT NULL DEFAULT 'COVER',
    `title` VARCHAR(191) NULL,
    `altText` VARCHAR(300) NULL,
    `credit` VARCHAR(191) NULL,
    `mimeType` VARCHAR(64) NOT NULL,
    `width` INT NOT NULL,
    `height` INT NOT NULL,
    `sizeBytes` INT NOT NULL,
    `data` LONGBLOB NOT NULL,
    `isDemo` TINYINT(1) NOT NULL DEFAULT 1,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    INDEX `media_assets_ownerType_ownerId_idx`(`ownerType`, `ownerId`),
    INDEX `media_assets_role_idx`(`role`),
    INDEX `media_assets_ownerType_role_sortOrder_idx`(`ownerType`, `role`, `sortOrder`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
