CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`allow_registration` integer DEFAULT false NOT NULL,
	`file_storage_quota_bytes` integer DEFAULT 5368709120,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assistants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`system_prompt` text,
	`default_provider_config_id` text,
	`default_model_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_provider_config_id`) REFERENCES `provider_configs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistants_owner_name_uidx` ON `assistants` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`assistant_id` text NOT NULL,
	`title` text NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`summary_text` text,
	`summary_up_to_message_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topics_assistant_list_idx` ON `topics` (`assistant_id`,`is_favorite`,updated_at desc,id desc);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_issuer_account_id_uidx` ON `accounts` (`issuer`,`account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `two_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factors_user_id_idx` ON `two_factors` (`user_id`);--> statement-breakpoint
CREATE INDEX `two_factors_secret_idx` ON `two_factors` (`secret`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`image` text,
	`username` text NOT NULL,
	`display_username` text,
	`role` text DEFAULT 'user' NOT NULL,
	`is_anonymous` integer DEFAULT false NOT NULL,
	`file_quota_bytes` integer,
	`theme_mode` text DEFAULT 'system' NOT NULL,
	`theme_preset` text DEFAULT 'default' NOT NULL,
	`model_preferences` text,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `chat_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text,
	`request_hash` text,
	`request_expires_at` integer,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`topic_id` text,
	`assistant_message_id` text,
	`target_deleted_at` integer,
	`input` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_generations_request_idx` ON `chat_generations` (`user_id`,`request_id`) WHERE request_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_generations_active_topic_idx` ON `chat_generations` (`topic_id`) WHERE status in ('queued', 'running', 'stopping');--> statement-breakpoint
CREATE INDEX `chat_generations_user_status_idx` ON `chat_generations` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `chat_generations_status_finished_idx` ON `chat_generations` (`status`,`finished_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`outcome` text,
	`error_message` text,
	`provider_config_id` text,
	`model_id` text,
	`reasoning_ms` integer,
	`usage` text,
	`finish_reason` text,
	`translations` text,
	`group_id` text NOT NULL,
	`is_selected` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`group_created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_config_id`) REFERENCES `provider_configs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_topic_created_idx` ON `chat_messages` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_messages_topic_group_idx` ON `chat_messages` (`topic_id`,`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_selected_version_idx` ON `chat_messages` (`group_id`) WHERE is_selected = 1;--> statement-breakpoint
CREATE TABLE `demo_usage_counters` (
	`subject` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`subject`, `day`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_key` text NOT NULL,
	`extracted_text` text,
	`extraction_status` text DEFAULT 'none' NOT NULL,
	`extraction_truncated` integer DEFAULT false NOT NULL,
	`provider_references` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_storage_key_unique` ON `files` (`storage_key`);--> statement-breakpoint
CREATE INDEX `files_user_idx` ON `files` (`user_id`);--> statement-breakpoint
CREATE TABLE `message_file_refs` (
	`message_id` text NOT NULL,
	`file_id` text NOT NULL,
	PRIMARY KEY(`message_id`, `file_id`),
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `message_file_refs_file_idx` ON `message_file_refs` (`file_id`);--> statement-breakpoint
CREATE TABLE `provider_file_delete_retries` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_file_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer NOT NULL,
	`last_status` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `postgres_import` (
	`id` text PRIMARY KEY NOT NULL,
	`imported_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`source_info` text NOT NULL,
	`row_counts` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_format` text DEFAULT 'openai-compatible' NOT NULL,
	`encrypted_api_key` text,
	`api_key_last_four` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`files_api_unsupported_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configs_owner_name_uidx` ON `provider_configs` (`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `provider_configs_visibility_idx` ON `provider_configs` (`visibility`);--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_config_id` text NOT NULL,
	`model_id` text NOT NULL,
	`context_tokens` integer DEFAULT 256000 NOT NULL,
	`output_tokens` integer DEFAULT 65536 NOT NULL,
	`input_modalities` text DEFAULT '["text"]' NOT NULL,
	`output_modalities` text DEFAULT '["text"]' NOT NULL,
	`reasoning` integer DEFAULT false NOT NULL,
	`reasoning_options` text DEFAULT '[]' NOT NULL,
	`vendor_key` text,
	`metadata_source` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`provider_config_id`) REFERENCES `provider_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_models_config_model_uidx` ON `provider_models` (`provider_config_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `search_provider_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`api_key_last_four` text NOT NULL,
	`base_url` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_provider_settings_user_provider_uidx` ON `search_provider_settings` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `search_provider_settings_user_position_idx` ON `search_provider_settings` (`user_id`,`position`);--> statement-breakpoint
INSERT INTO `app_settings` (`id`, `allow_registration`)
VALUES ('0193e1c0-0000-7000-8000-000000000001', 0);