CREATE TABLE `messages` (
	`uuid` text NOT NULL,
	`sessionId` text NOT NULL,
	`parentUuid` text,
	`type` text NOT NULL,
	`role` text,
	`timestamp` text,
	`model` text,
	`messageId` text,
	`isSidechain` integer NOT NULL,
	`isMeta` integer NOT NULL,
	`text` text NOT NULL,
	`toolNames` text NOT NULL,
	`usage` text,
	`byteOffset` integer NOT NULL,
	`byteLength` integer NOT NULL,
	`toolUses` text DEFAULT '{}' NOT NULL,
	`errorCount` integer DEFAULT 0 NOT NULL,
	`costUsd` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`sessionId`, `uuid`),
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_session_offset` ON `messages` (`sessionId`,`byteOffset`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`dir` text NOT NULL,
	`path` text NOT NULL,
	`pathExists` integer NOT NULL,
	`pathSource` text NOT NULL,
	`sessionCount` integer DEFAULT 0 NOT NULL,
	`lastActivityAt` text,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cacheRead` integer DEFAULT 0 NOT NULL,
	`cacheCreation` integer DEFAULT 0 NOT NULL,
	`thinking` integer DEFAULT 0 NOT NULL,
	`costUsd` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`file` text NOT NULL,
	`fileSize` integer NOT NULL,
	`fileMtimeMs` real NOT NULL,
	`fileIdentity` text NOT NULL,
	`prefixHash` text NOT NULL,
	`tailHash` text NOT NULL,
	`byteOffset` integer DEFAULT 0 NOT NULL,
	`title` text,
	`firstAt` text,
	`lastAt` text,
	`cwd` text,
	`cwdCounts` text DEFAULT '{}' NOT NULL,
	`gitBranch` text,
	`version` text,
	`models` text DEFAULT '[]' NOT NULL,
	`messageCount` integer DEFAULT 0 NOT NULL,
	`toolUseCounts` text DEFAULT '{}' NOT NULL,
	`permissionModes` text DEFAULT '[]' NOT NULL,
	`errorCount` integer DEFAULT 0 NOT NULL,
	`malformed` integer DEFAULT 0 NOT NULL,
	`unknownTypes` text DEFAULT '{}' NOT NULL,
	`isSubagent` integer DEFAULT false NOT NULL,
	`parentSessionId` text,
	`parentToolUseId` text,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cacheRead` integer DEFAULT 0 NOT NULL,
	`cacheCreation` integer DEFAULT 0 NOT NULL,
	`thinking` integer DEFAULT 0 NOT NULL,
	`costUsd` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_project` ON `sessions` (`projectId`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`date` text NOT NULL,
	`projectId` text NOT NULL,
	`model` text NOT NULL,
	`sessionId` text NOT NULL,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cacheRead` integer DEFAULT 0 NOT NULL,
	`cacheCreation` integer DEFAULT 0 NOT NULL,
	`thinking` integer DEFAULT 0 NOT NULL,
	`costUsd` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `projectId`, `model`, `sessionId`),
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
