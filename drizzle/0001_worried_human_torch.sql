CREATE TABLE `history_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_key` text NOT NULL,
	`record_type` text NOT NULL,
	`quiz_kind` text NOT NULL,
	`source` text NOT NULL,
	`correct` integer,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_history_user_client_key` ON `history_records` (`user_id`,`client_key`);--> statement-breakpoint
CREATE INDEX `idx_history_user_created_at` ON `history_records` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_history_user_type_correct` ON `history_records` (`user_id`,`record_type`,`correct`);