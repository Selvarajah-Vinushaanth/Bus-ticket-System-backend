-- Create chat_history table in Supabase
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS chat_history (
  id BIGSERIAL PRIMARY KEY,
  conductor_id INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  session_id VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_chat_history_conductor ON chat_history(conductor_id);
CREATE INDEX idx_chat_history_created_at ON chat_history(created_at DESC);
CREATE INDEX idx_chat_history_session ON chat_history(session_id);

-- Add foreign key constraint (optional, if conductors table exists)
-- ALTER TABLE chat_history 
-- ADD CONSTRAINT fk_conductor 
-- FOREIGN KEY (conductor_id) 
-- REFERENCES conductors(id) 
-- ON DELETE CASCADE;

-- Enable Row Level Security (RLS) - optional for security
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- Create policy to allow conductors to see only their own chat history
CREATE POLICY "Conductors can view own chat history"
  ON chat_history
  FOR SELECT
  USING (true); -- Adjust based on your auth setup

CREATE POLICY "Conductors can insert own messages"
  ON chat_history
  FOR INSERT
  WITH CHECK (true); -- Adjust based on your auth setup

CREATE POLICY "Conductors can delete own chat history"
  ON chat_history
  FOR DELETE
  USING (true); -- Adjust based on your auth setup

-- Grant permissions
GRANT ALL ON chat_history TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE chat_history_id_seq TO anon, authenticated;
