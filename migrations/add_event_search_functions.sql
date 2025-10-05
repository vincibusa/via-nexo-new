-- Migration: Add Event Search Functions for AI RAG
-- This enables semantic search and geo-filtering for events

-- Function to search event embeddings using vector similarity
CREATE OR REPLACE FUNCTION match_event_embeddings(
  query_embedding vector(1536),
  candidate_ids uuid[],
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 12
)
RETURNS TABLE (
  entity_id uuid,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.entity_id,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM embeddings e
  WHERE
    e.entity_type = 'event'
    AND e.entity_id = ANY(candidate_ids)
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to find events within radius (via their place location)
CREATE OR REPLACE FUNCTION events_within_radius(
  center_lat float,
  center_lon float,
  radius_meters float
)
RETURNS TABLE (
  id uuid
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT e.id
  FROM events e
  INNER JOIN places p ON e.place_id = p.id
  WHERE
    e.is_published = true
    AND e.start_datetime > NOW()
    AND p.is_published = true
    AND p.is_listed = true
    AND p.location IS NOT NULL
    AND ST_DWithin(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(center_lon, center_lat), 4326)::geography,
      radius_meters
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION match_event_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION match_event_embeddings TO anon;
GRANT EXECUTE ON FUNCTION events_within_radius TO authenticated;
GRANT EXECUTE ON FUNCTION events_within_radius TO anon;
