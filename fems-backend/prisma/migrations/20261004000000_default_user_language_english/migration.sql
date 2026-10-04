ALTER TABLE `User` ALTER COLUMN `preferredLanguage` SET DEFAULT 'en';

UPDATE `User`
SET `preferredLanguage` = 'en'
WHERE `isDemo` = 1;
