-- GroqCloud becomes a supported AI provider alongside OpenRouter, so analyses,
-- alerts and assistant messages can record which model wrote their narrative.
-- Existing rows are untouched: the enum only gains a value.

ALTER TABLE `ai_analyses`
  MODIFY `provider` ENUM('GROQ', 'OPENROUTER', 'GEMINI', 'LOCAL_RULE_ENGINE') NOT NULL DEFAULT 'LOCAL_RULE_ENGINE';

ALTER TABLE `ai_alerts`
  MODIFY `detector` ENUM('GROQ', 'OPENROUTER', 'GEMINI', 'LOCAL_RULE_ENGINE') NOT NULL DEFAULT 'LOCAL_RULE_ENGINE';

ALTER TABLE `ai_messages`
  MODIFY `provider` ENUM('GROQ', 'OPENROUTER', 'GEMINI', 'LOCAL_RULE_ENGINE') NULL;
