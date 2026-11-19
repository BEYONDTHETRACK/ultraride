// Edge Function translate-race : traduit en anglais les textes d'une fiche
// ultra (description courte, description longue, terrain) et enregistre le
// résultat dans races.blurb_en / long_blurb_en / terrain_en.
//
// Corps JSON :
//   { race_id }              traduit la fiche si l'anglais manque ou est périmé
//                            (n'importe qui : bouton « Translate » de la fiche,
//                            trigger SQL). Ne touche pas une traduction relue.
//   { race_id, force: true } régénère même une traduction relue
//                            (admin, ou organisateur propriétaire de la fiche).
//   { batch: n }             traduit jusqu'à n fiches publiées à traduire
//                            (admin ou jeton x-cron-secret).
//
// Secrets : ANTHROPIC_API_KEY ; fournis par Supabase : SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Jeton du trigger : Vault « translate_race_token ».

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
const MAX_BATCH = 40;
const CONCURRENCY = 5;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You translate French texts describing ultra-distance cycling races (road, gravel, MTB) into natural, fluent English for an international audience of cyclists.

Rules:
- Translate faithfully. Do not add, remove or invent any information.
- Keep proper nouns as they are: race names, organiser names, place names, region names (e.g. "Massif des Vosges" may become "the Vosges mountains" only when it reads naturally).
- Use English number formatting: 1,000 km, 18,000 m of climbing ("D+" becomes "of climbing" or "elevation gain"), 24 h.
- Use "riders" for participants. "Autonomie" = self-supported, "semi-autonomie" = semi-supported, "assistance" = support, "trace" = route/track, "CP / checkpoint" = checkpoint, "dénivelé positif" = elevation gain.
- Keep the tone of the original (enthusiastic, direct). Keep the paragraph and line breaks of the original.
- "blurb" is a short card description: keep it short, ideally under 160 characters.
- "terrain" is a few words describing the surface: translate it in a few words too.

Reply with a single JSON object only, with exactly the keys you were given, each value being the English translation. No comments, no markdown.`;

type Race = {
  id: string;
  status: string;
  created_by: string | null;
  blurb: string | null;
  long_blurb: string | null;
  terrain: string | null;
  blurb_en: string | null;
  long_blurb_en: string | null;
  terrain_en: string | null;
  en_source_md5: string | null;
  en_reviewed: boolean;
};

const COLS = "id, status, created_by, blurb, long_blurb, terrain, blurb_en, long_blurb_en, terrain_en, en_source_md5, en_reviewed";

async function frMd5(supabase: SupabaseClient, r: Race): Promise<string> {
  const { data, error } = await supabase.rpc("race_fr_md5", {
    p_blurb: r.blurb, p_long: r.long_blurb, p_terrain: r.terrain,
  });
  if (error) throw error;
  return data as string;
}

async function callClaude(input: Record<string, string>): Promise<Record<string, string>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Secret ANTHROPIC_API_KEY absent");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(input) }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`API Anthropic HTTP ${res.status} : ${raw.slice(0, 300)}`);
  const data = JSON.parse(raw);
  const text = (data.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Réponse sans JSON : " + text.slice(0, 200));
  const out = JSON.parse(m[0]);
  const clean: Record<string, string> = {};
  for (const k of Object.keys(input)) {
    if (typeof out[k] === "string" && out[k].trim()) clean[k] = out[k].trim();
  }
  return clean;
}

/** Traduit une fiche. Renvoie les champs anglais enregistrés, ou null si rien à faire. */
async function translateRace(supabase: SupabaseClient, r: Race, force: boolean) {
  const md5 = await frMd5(supabase, r);
  const stale = r.en_source_md5 !== md5;
  if (!force && (r.en_reviewed || !stale)) {
    return { skipped: true, blurb_en: r.blurb_en, long_blurb_en: r.long_blurb_en, terrain_en: r.terrain_en };
  }

  const input: Record<string, string> = {};
  // Première passe (jamais traduite) : on garde la description courte anglaise
  // déjà écrite (vignettes Instagram).
  const keepBlurb = !force && r.en_source_md5 === null && !!r.blurb_en;
  if (r.blurb && !keepBlurb) input.blurb = r.blurb;
  if (r.long_blurb) input.long_blurb = r.long_blurb;
  if (r.terrain) input.terrain = r.terrain;

  const tr = Object.keys(input).length ? await callClaude(input) : {};
  const patch = {
    blurb_en: keepBlurb ? r.blurb_en : (tr.blurb ?? (r.blurb ? r.blurb_en : null)),
    long_blurb_en: tr.long_blurb ?? (r.long_blurb ? r.long_blurb_en : null),
    terrain_en: tr.terrain ?? (r.terrain ? r.terrain_en : null),
    en_source_md5: md5,
    en_reviewed: false,
    en_translated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("races").update(patch).eq("id", r.id);
  if (error) throw error;
  return { skipped: false, blurb_en: patch.blurb_en, long_blurb_en: patch.long_blurb_en, terrain_en: patch.terrain_en };
}

async function caller(req: Request, supabase: SupabaseClient) {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data: ok } = await supabase.rpc("translate_race_token_ok", { p_token: secret });
    if (ok === true) return { kind: "cron" as const, id: null, role: null };
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (jwt) {
    const { data } = await supabase.auth.getUser(jwt);
    if (data?.user) {
      const { data: p } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
      return { kind: "user" as const, id: data.user.id, role: (p?.role as string) ?? null };
    }
  }
  return { kind: "anon" as const, id: null, role: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let body: { race_id?: string; force?: boolean; batch?: number } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return json({ error: "Corps JSON invalide" }, 400);
  }

  const who = await caller(req, supabase);
  const isAdmin = who.kind === "cron" || who.role === "admin";

  try {
    if (body.batch) {
      if (!isAdmin) return json({ error: "Non autorisé" }, 401);
      const n = Math.min(Math.max(1, Number(body.batch) || 10), MAX_BATCH);
      const { data: ids, error } = await supabase.rpc("races_needing_translation", { p_limit: n });
      if (error) throw error;
      const list = (ids as { id: string }[]).map((x) => x.id);
      const { data: races, error: e2 } = await supabase.from("races").select(COLS).in("id", list.length ? list : ["00000000-0000-0000-0000-000000000000"]);
      if (e2) throw e2;
      const done: string[] = [];
      const failed: { id: string; error: string }[] = [];
      const queue = [...(races as Race[])];
      await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
          const r = queue.shift()!;
          try { await translateRace(supabase, r, false); done.push(r.id); }
          catch (e) { failed.push({ id: r.id, error: String((e as Error).message || e) }); }
        }
      }));
      const { data: remaining } = await supabase.rpc("races_needing_translation_count");
      return json({ translated: done.length, failed, remaining });
    }

    if (!body.race_id) return json({ error: "race_id manquant" }, 400);
    const { data: race, error } = await supabase.from("races").select(COLS).eq("id", body.race_id).maybeSingle();
    if (error) throw error;
    if (!race) return json({ error: "Fiche introuvable" }, 404);
    const r = race as Race;

    if (body.force) {
      const owner = who.role === "organizer" && who.id && r.created_by === who.id;
      if (!isAdmin && !owner) return json({ error: "Non autorisé" }, 401);
    } else if (r.status !== "published" && !isAdmin) {
      return json({ error: "Fiche non publiée" }, 403);
    }

    const out = await translateRace(supabase, r, !!body.force);
    return json(out);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
