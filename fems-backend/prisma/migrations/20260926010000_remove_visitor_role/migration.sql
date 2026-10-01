-- Public viewers are anonymous and must not be represented as user accounts.

DELETE ur
FROM `user_roles` ur
INNER JOIN `roles` r ON r.`id` = ur.`roleId`
WHERE r.`name` = 'VISITOR';

DELETE FROM `users`
WHERE `email` = 'demo.visitor@fems.cm';

DELETE FROM `roles`
WHERE `name` = 'VISITOR';
