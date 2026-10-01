-- GroqCloud becomes a supported AI provider alongside Gemini, so analyses and
-- assistant messages can record which model actually wrote their narrative.
-- Existing rows are untouched: the enum only gains a value.

ALTER TABLE `ai_analyses`
  MODIFY `provider` ENUM('GROQ', 'GEMINI', 'LOCAL_RULE_ENGINE') NOT NULL DEFAULT 'LOCAL_RULE_ENGINE';

ALTER TABLE `ai_messages`
  MODIFY `provider` ENUM('GROQ', 'GEMINI', 'LOCAL_RULE_ENGINE') NULL;
