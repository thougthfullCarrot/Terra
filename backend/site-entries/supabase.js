// Bundled to site/vendor/supabase.js. The site loads it only once accounts are
// configured, so the open (unconfigured) site never downloads it.
export { createClient } from '@supabase/supabase-js';
