-- OMate schema snapshot: ONLY schema and permissions, no user rows.

-- Run on a new, empty Supabase project.

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public."omate_backup_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL,
  "conversation_key" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "items" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "complete_types" text[] DEFAULT '{}'::text[] NOT NULL,
  "expected_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "preview" jsonb,
  "preview_token" text,
  "last_result" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "omate_backup_sessions_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "omate_backup_sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "omate_backup_sessions_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'previewed'::text, 'applied'::text])))
);

ALTER TABLE public."omate_backup_sessions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."omate_backup_sessions" FROM anon, authenticated;

GRANT ALL ON TABLE public."omate_backup_sessions" TO service_role;

CREATE TABLE IF NOT EXISTS public."omate_context_window" (
  "owner_id" uuid NOT NULL,
  "conversation_key" text NOT NULL,
  "messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "omate_context_window_conversation_key_check" CHECK (((length(conversation_key) >= 1) AND (length(conversation_key) <= 180))),
  CONSTRAINT "omate_context_window_messages_check" CHECK (((jsonb_typeof(messages) = 'array'::text) AND (jsonb_array_length(messages) <= 40))),
  CONSTRAINT "omate_context_window_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "omate_context_window_pkey" PRIMARY KEY (owner_id, conversation_key)
);

ALTER TABLE public."omate_context_window" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."omate_context_window" FROM anon, authenticated;

GRANT ALL ON TABLE public."omate_context_window" TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."omate_context_window" TO authenticated;

CREATE TABLE IF NOT EXISTS public."omate_mcp_access" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "conversation_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + '90 days'::interval) NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "omate_mcp_access_conversation_key_check" CHECK (((char_length(conversation_key) >= 1) AND (char_length(conversation_key) <= 180))),
  CONSTRAINT "omate_mcp_access_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "omate_mcp_access_pkey" PRIMARY KEY (id),
  CONSTRAINT "omate_mcp_access_token_hash_check" CHECK ((char_length(token_hash) = 64)),
  CONSTRAINT "omate_mcp_access_token_hash_key" UNIQUE (token_hash)
);

ALTER TABLE public."omate_mcp_access" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."omate_mcp_access" FROM anon, authenticated;

GRANT ALL ON TABLE public."omate_mcp_access" TO service_role;

CREATE TABLE IF NOT EXISTS public."omate_memory" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL,
  "conversation_key" text NOT NULL,
  "actor_key" text DEFAULT 'unknown'::text NOT NULL,
  "memory_type" text DEFAULT 'fact'::text NOT NULL,
  "content" text NOT NULL,
  "source" text DEFAULT 'livepage'::text NOT NULL,
  "importance" smallint DEFAULT 3 NOT NULL,
  "occurred_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "event_key" text,
  "chat_ref" text,
  CONSTRAINT "omate_memory_content_check" CHECK (((char_length(content) >= 1) AND (char_length(content) <= 12000))),
  CONSTRAINT "omate_memory_importance_check" CHECK (((importance >= 1) AND (importance <= 5))),
  CONSTRAINT "omate_memory_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "omate_memory_pkey" PRIMARY KEY (id)
);

ALTER TABLE public."omate_memory" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."omate_memory" FROM anon, authenticated;

GRANT ALL ON TABLE public."omate_memory" TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."omate_memory" TO authenticated;

CREATE TABLE IF NOT EXISTS public."omate_resources" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL,
  "conversation_key" text NOT NULL,
  "resource_type" text NOT NULL,
  "title" text DEFAULT ''::text NOT NULL,
  "content" text NOT NULL,
  "source_file" text DEFAULT ''::text NOT NULL,
  "keywords" text[] DEFAULT '{}'::text[] NOT NULL,
  "secondary_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
  "is_constant" boolean DEFAULT false NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "position" text DEFAULT 'after_char'::text NOT NULL,
  "depth" integer DEFAULT 0 NOT NULL,
  "order_weight" integer DEFAULT 100 NOT NULL,
  "trigger_logic" text DEFAULT 'andAny'::text NOT NULL,
  "probability" integer DEFAULT 100 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "embedding" extensions.vector(384),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sync_external_id" text,
  CONSTRAINT "omate_resources_content_check" CHECK (((length(content) >= 1) AND (length(content) <= 20000))),
  CONSTRAINT "omate_resources_conversation_key_check" CHECK (((length(conversation_key) >= 1) AND (length(conversation_key) <= 180))),
  CONSTRAINT "omate_resources_depth_check" CHECK (((depth >= 0) AND (depth <= 200))),
  CONSTRAINT "omate_resources_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "omate_resources_pkey" PRIMARY KEY (id),
  CONSTRAINT "omate_resources_probability_check" CHECK (((probability >= 0) AND (probability <= 100))),
  CONSTRAINT "omate_resources_resource_type_check" CHECK ((resource_type = ANY (ARRAY['long_term'::text, 'prompt'::text, 'worldbook'::text, 'knowledge'::text])))
);

ALTER TABLE public."omate_resources" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."omate_resources" FROM anon, authenticated;

GRANT ALL ON TABLE public."omate_resources" TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."omate_resources" TO authenticated;

CREATE INDEX omate_backup_sessions_by_owner ON public.omate_backup_sessions USING btree (owner_id, conversation_key, updated_at DESC);

CREATE INDEX omate_mcp_access_owner_idx ON public.omate_mcp_access USING btree (owner_id, created_at DESC);

CREATE INDEX omate_memory_chat_scope_idx ON public.omate_memory USING btree (owner_id, conversation_key, chat_ref) WHERE (chat_ref IS NOT NULL);

CREATE INDEX omate_memory_owner_content_fts_idx ON public.omate_memory USING gin (to_tsvector('simple'::regconfig, content));

CREATE INDEX omate_memory_owner_conversation_idx ON public.omate_memory USING btree (owner_id, conversation_key, created_at DESC);

CREATE UNIQUE INDEX omate_memory_owner_space_event_key_uidx ON public.omate_memory USING btree (owner_id, conversation_key, event_key);

CREATE INDEX omate_resources_owner_space_idx ON public.omate_resources USING btree (owner_id, conversation_key, resource_type, enabled);

CREATE UNIQUE INDEX omate_resources_sync_key_unique ON public.omate_resources USING btree (owner_id, conversation_key, resource_type, sync_external_id);

CREATE POLICY "own_context_window_delete" ON public."omate_context_window" FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "own_context_window_insert" ON public."omate_context_window" FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "own_context_window_read" ON public."omate_context_window" FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "own_context_window_update" ON public."omate_context_window" FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "owner delete memory" ON public."omate_memory" FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "owner insert memory" ON public."omate_memory" FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "owner select memory" ON public."omate_memory" FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "owner update memory" ON public."omate_memory" FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "omate resources owner delete" ON public."omate_resources" FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "omate resources owner insert" ON public."omate_resources" FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "omate resources owner select" ON public."omate_resources" FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "omate resources owner update" ON public."omate_resources" FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = owner_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));
