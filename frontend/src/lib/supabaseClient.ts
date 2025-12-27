import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://likyygzbjgrzsdyzsira.supabase.co/';

export const supabase = createClient(
    supabaseUrl,
    import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_jU2_op2cAI7Fhbw9ygEt4g_hl-suGcf'
);
