-- Add columns to tokens table for frontend compatibility (TokenInfo model)
ALTER TABLE tokens ADD COLUMN quota TEXT DEFAULT NULL;
ALTER TABLE tokens ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tokens ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE tokens ADD COLUMN note TEXT DEFAULT '';
