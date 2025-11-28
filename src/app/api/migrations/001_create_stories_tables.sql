-- Create stories table
CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type TEXT DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  text_overlay TEXT,
  place_id UUID REFERENCES places(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  is_published BOOLEAN DEFAULT true,

  -- Index for efficient querying
  CONSTRAINT stories_valid_dates CHECK (expires_at > created_at)
);

-- Create story_views table (tracks who viewed which stories)
CREATE TABLE IF NOT EXISTS story_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),

  -- One view per user per story
  UNIQUE(story_id, user_id)
);

-- Create indexes for performance
CREATE INDEX idx_stories_user_id ON stories(user_id);
CREATE INDEX idx_stories_created_at ON stories(created_at DESC);
CREATE INDEX idx_stories_expires_at ON stories(expires_at);
CREATE INDEX idx_story_views_story_id ON story_views(story_id);
CREATE INDEX idx_story_views_user_id ON story_views(user_id);

-- Create RLS Policies
-- Stories are always viewable (public)
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stories are viewable by everyone"
  ON stories FOR SELECT
  USING (true);

CREATE POLICY "Users can create their own stories"
  ON stories FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own stories"
  ON stories FOR DELETE
  USING (user_id = auth.uid());

-- Story views are private
ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own story views"
  ON story_views FOR SELECT
  USING (user_id = auth.uid() OR story_id IN (SELECT id FROM stories WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert view records"
  ON story_views FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Add RLS for existing tables if not already done
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Profiles are always public"
  ON profiles FOR SELECT
  USING (true);
