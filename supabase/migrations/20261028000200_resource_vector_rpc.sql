-- Restore the original vector search RPC required by omate-resources-api.
-- This uses the source project's function definition (schema-only).
CREATE OR REPLACE FUNCTION public.omate_match_resources(
  p_owner uuid,
  p_space text,
  p_query_embedding extensions.vector,
  p_limit integer DEFAULT 6
)
RETURNS TABLE(id uuid, title text, content text, resource_type text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
 SELECT r.id, r.title, r.content, r.resource_type,
        1 - (r.embedding <=> p_query_embedding) AS similarity
 FROM public.omate_resources r
 WHERE r.owner_id = p_owner
   AND r.conversation_key = p_space
   AND r.enabled = true
   AND r.resource_type = 'knowledge'
   AND r.embedding IS NOT NULL
 ORDER BY r.embedding <=> p_query_embedding
 LIMIT LEAST(GREATEST(p_limit, 1), 12);
$function$;

REVOKE ALL ON FUNCTION public.omate_match_resources(uuid, text, extensions.vector, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omate_match_resources(uuid, text, extensions.vector, integer) TO service_role;
