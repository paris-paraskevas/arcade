// @ts-check
import { defineConfig } from 'astro/config';

// Static output: the shelf + game pages build to plain HTML/JS/CSS and deploy
// as Cloudflare Worker static assets. Auth, scores, and leaderboards run
// client-side via the Supabase anon key (RLS protects the data). Realtime
// 2-player will live in a SEPARATE Durable Objects Worker, not here.
export default defineConfig({
  site: 'https://arcade.businessofzeus.workers.dev',
  build: { format: 'directory' },
});
