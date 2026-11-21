CREATE TRIGGER `chat_messages_file_refs_ai`
AFTER INSERT ON `chat_messages`
BEGIN
  INSERT OR IGNORE INTO `message_file_refs` (`message_id`, `file_id`)
  SELECT NEW.`id`, substr(url, 12)
  FROM (
    SELECT CASE
      WHEN p.`type` = 'object' AND json_type(p.`value`, '$.url') = 'text' THEN p.`value`->>'url'
    END AS url
    FROM json_each(NEW.`parts`) AS p
  )
  WHERE url GLOB '/api/files/?*';
END;
--> statement-breakpoint
CREATE TRIGGER `chat_messages_file_refs_au`
AFTER UPDATE OF `parts` ON `chat_messages`
BEGIN
  DELETE FROM `message_file_refs` WHERE `message_id` = NEW.`id`;
  INSERT OR IGNORE INTO `message_file_refs` (`message_id`, `file_id`)
  SELECT NEW.`id`, substr(url, 12)
  FROM (
    SELECT CASE
      WHEN p.`type` = 'object' AND json_type(p.`value`, '$.url') = 'text' THEN p.`value`->>'url'
    END AS url
    FROM json_each(NEW.`parts`) AS p
  )
  WHERE url GLOB '/api/files/?*';
END;
