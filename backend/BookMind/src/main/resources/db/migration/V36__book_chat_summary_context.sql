-- Records which spoiler-free summary, if any, was given to the model as context for a chat answer.
ALTER TABLE book_chat_turns
    ADD COLUMN context_summary_id UUID REFERENCES summaries(id) ON DELETE SET NULL;
