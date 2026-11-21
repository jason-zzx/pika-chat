CREATE TABLE `postgres_import` (
	`id` text PRIMARY KEY NOT NULL,
	`imported_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`source_info` text NOT NULL,
	`row_counts` text NOT NULL
);
