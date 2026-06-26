import { createClient } from '@supabase/supabase-js';

// Client-side Supabase. The anon key is public by design; RLS (see
// supabase/migrations) is what actually protects the data. Session is
// persisted in localStorage by supabase-js, shared across pages.
const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anon);
