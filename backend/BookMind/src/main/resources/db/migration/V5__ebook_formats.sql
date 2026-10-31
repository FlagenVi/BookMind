ALTER TABLE documents DROP CONSTRAINT documents_source_type;
ALTER TABLE documents ADD CONSTRAINT documents_source_type
CHECK (source_type IN ('manual','txt','pdf','docx','epub','fb2'));
