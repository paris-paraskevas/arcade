// arcade-client.js — shared score submission for every game page.
//
// A classic <script> (no modules, no bundler) so it works on the static game
// pages. It posts a finished-game score straight to Supabase PostgREST — it does
// NOT pull in supabase-js (that's ~200 KB; game pages stay light/fast). Scores
// are submitted only for signed-in players; guests (and file:// opens) are a
// silent no-op, so games keep running exactly as before when offline.
//
// The access token is read from the session supabase-js persists in
// localStorage on the Astro shell pages (same origin). Lower-is-better metrics
// are encoded as BASE - value (see arcade-metrics.js) so the single
// higher-is-better leaderboard ranks every game; the board decodes for display.
//
// Usage from a game, at game-over:  window.Arcade && Arcade.submitScore('snake', score);
(() => {
  'use strict';

  // Public config — the anon key is public by design; RLS protects the data.
  const SUPA_URL = 'https://drkqjfcejhffwpbptzmv.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRya3FqZmNlamhmZndwYnB0em12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NzQ3OTksImV4cCI6MjA5ODA1MDc5OX0._KVrvzvgCxUdS_o5nXGg5QRxgSdLBnYcmBi-GzDuCJI';
  const STORAGE_KEY = 'sb-drkqjfcejhffwpbptzmv-auth-token';
  const BASE = 1000000000;     // 1e9 — encode base for lower-is-better metrics
  const INT_MAX = 2147483647;  // postgres integer ceiling (score column type)

  // Pull {token, userId} from the persisted supabase session, or null if signed out.
  function session() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const s = parsed && parsed.access_token ? parsed : (parsed && parsed.currentSession);
      if (!s || !s.access_token || !s.user || !s.user.id) return null;
      return { token: s.access_token, userId: s.user.id };
    } catch (e) { return null; }
  }

  function metricDir(slug) {
    const m = window.ARCADE_METRICS && window.ARCADE_METRICS[slug];
    return m && m.dir === 'lo' ? 'lo' : 'hi';
  }

  // Raw metric value -> stored (always higher-is-better) integer, or null if invalid.
  function encode(slug, value) {
    let v = Math.round(value);
    if (!isFinite(v) || v < 0) return null;
    if (metricDir(slug) === 'lo') v = Math.max(0, BASE - v); // smaller raw -> larger stored
    if (v < 0 || v > INT_MAX) return null;
    return v;
  }

  // Submit a finished-game score. Returns a Promise<boolean> (true = recorded).
  // Never throws and never blocks gameplay — failures resolve false.
  async function submitScore(slug, value) {
    try {
      if (!slug || typeof value !== 'number') return false;
      const stored = encode(slug, value);
      if (stored === null) return false;
      const s = session();
      if (!s) return false; // guest — nothing to submit
      const res = await fetch(SUPA_URL + '/rest/v1/score', {
        method: 'POST',
        headers: {
          apikey: ANON,
          authorization: 'Bearer ' + s.token,
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
        body: JSON.stringify({ user_id: s.userId, game: slug, score: stored }),
      });
      return res.ok;
    } catch (e) { return false; }
  }

  window.Arcade = window.Arcade || {};
  window.Arcade.submitScore = submitScore;
  window.Arcade.isSignedIn = function () { return !!session(); };
})();
