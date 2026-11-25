// send-push : regroupe la file push_queue et envoie UNE notification par
// vague aux utilisateurs de l'app mobile (Firebase Cloud Messaging, topics).
//
//   - « Nouvel ultra »          → topic nouveaux-ultras
//   - « Des ultras sont à jour » → topic mises-a-jour
//   - Annonce libre (corps { custom: {...} }) → un sujet ou les deux, sans doublon
//     (onglet « Notifications » de l'admin, ou tâche planifiée)
//
// Une vague est envoyée quand rien de neuf n'est arrivé dans la file depuis
// QUIET_MINUTES : valider 15 fiches d'affilée donne une seule notification.
//
// Appelée toutes les 15 min par pg_cron (en-tête x-cron-secret), ou à la main
// par un admin connecté (bouton « Envoyer maintenant », ignore le délai).
//
// Secrets attendus : CRON_SECRET (déjà en place), FCM_SERVICE_ACCOUNT
// (contenu JSON complet de la clé de compte de service Firebase).
// À déployer avec « Verify JWT » désactivé : la fonction vérifie elle-même.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const QUIET_MINUTES = 60; // une campagne du lundi avec des pauses reste une seule vague
const SITE = "https://ultraride.eu";

const TOPIC = { new_race: "nouveaux-ultras", race_update: "mises-a-jour" } as const;
type Kind = keyof typeof TOPIC;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/* ---------- authentification ---------- */

type Caller = { kind: "cron" | "manual"; userId: string | null } | null;

// Utilisateur derrière un jeton de session : appel direct à /auth/v1/user
// (getUser(jwt) répond parfois « Auth session missing » côté serveur).
async function userIdFromJwt(jwt: string): Promise<string | null> {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id || null;
}

async function authorize(req: Request, supabase: SupabaseClient): Promise<Caller> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const sentSecret = req.headers.get("x-cron-secret");
  if (cronSecret && sentSecret && sentSecret === cronSecret) return { kind: "cron", userId: null };
  // Jeton de la tâche planifiée rangé dans le coffre Supabase (race_check_token).
  if (sentSecret) {
    const { data: ok } = await supabase.rpc("race_check_token_ok", { p_token: sentSecret });
    if (ok === true) return { kind: "cron", userId: null };
  }

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const userId = await userIdFromJwt(jwt);
  if (!userId) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return profile?.role === "admin" ? { kind: "manual", userId } : null;
}

/* ---------- Firebase Cloud Messaging (API HTTP v1) ---------- */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function b64url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Jeton Google refusé : ${JSON.stringify(data)}`);
  return data.access_token;
}

async function sendToTopic(sa: ServiceAccount, token: string, topic: string, title: string, body: string, url: string) {
  return sendMessage(sa, token, { topic }, title, body, url);
}

// target : { topic } ou { condition } (plusieurs sujets sans doublon).
async function sendMessage(sa: ServiceAccount, token: string, target: { topic?: string; condition?: string }, title: string, body: string, url: string) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        ...target,
        notification: { title, body },
        data: { url },
        android: { notification: { channel_id: "ultras", color: "#C4622D" } },
        apns: { payload: { aps: { sound: "default" } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`FCM ${res.status} : ${await res.text()}`);
}

/* ---------- rédaction des messages ---------- */

type Race = { id: string; name: string; km: number | null; country: string | null };

function namesPreview(races: Race[], max = 3) {
  const names = races.slice(0, max).map((r) => r.name);
  return races.length > max ? `${names.join(", ")}…` : names.join(", ");
}

function compose(kind: Kind, races: Race[]) {
  const n = races.length;
  if (kind === "new_race") {
    if (n === 1) {
      const r = races[0];
      const details = [r.km ? `${Math.round(r.km).toLocaleString("fr-FR")} km` : null, r.country].filter(Boolean).join(" · ");
      return {
        title: "Nouvel ultra sur UltraRide",
        body: details ? `${r.name} · ${details}` : r.name,
        url: `/courses/${r.id}`,
      };
    }
    return { title: `${n} nouveaux ultras sur UltraRide`, body: namesPreview(races), url: "/ultras" };
  }
  return {
    title: "Des ultras sont à jour",
    body: n === 1
      ? `${races[0].name} : dates, parcours ou inscriptions mis à jour.`
      : `${n} fiches mises à jour : ${namesPreview(races)}`,
    url: n === 1 ? `/courses/${races[0].id}` : "/ultras",
  };
}

/* ---------- traitement ---------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const caller = await authorize(req, supabase);
  if (!caller) return json({ error: "Non autorisé" }, 401);

  const rawSa = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!rawSa) return json({ error: "Secret FCM_SERVICE_ACCOUNT manquant" }, 500);
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(rawSa);
  } catch {
    return json({ error: "FCM_SERVICE_ACCOUNT n'est pas un JSON valide" }, 500);
  }

  // Annonce libre : { "custom": { "topic": "all" | "nouveaux-ultras" | "mises-a-jour", "title", "body", "url": "/chemin" } }
  // Réservée à la tâche planifiée (jeton) et aux admins, comme le reste.
  let payload: { custom?: { topic?: string; title?: string; body?: string; url?: string } } = {};
  try { payload = await req.json(); } catch { /* corps vide : traitement normal de la file */ }
  if (payload?.custom) {
    const c = payload.custom;
    const all = Object.values(TOPIC) as string[];
    const topic = c.topic || "all";
    if (topic !== "all" && !all.includes(topic)) return json({ error: "Sujet inconnu" }, 400);
    if (!c.title?.trim() || !c.body?.trim()) return json({ error: "Titre et message requis" }, 400);
    // Lien : chemin du site (/ultras) ou adresse ultraride.eu ; tout autre lien est ramené à l'accueil.
    let path = (c.url || "/").trim();
    if (/^(www\.)?ultraride\.eu(\/|$)/i.test(path)) path = "https://" + path;
    if (/^https?:\/\//i.test(path)) {
      try {
        const u = new URL(path);
        path = /(^|\.)ultraride\.eu$/i.test(u.hostname) ? (u.pathname + u.search) || "/" : "/";
      } catch { path = "/"; }
    }
    if (!path.startsWith("/")) path = "/" + path;
    c.url = path;
    const target = topic === "all"
      ? { condition: all.map((t) => `'${t}' in topics`).join(" || ") }
      : { topic };
    let sendError: string | null = null;
    try {
      const token = await accessToken(sa);
      await sendMessage(sa, token, target, c.title.trim().slice(0, 120), c.body.trim().slice(0, 240), c.url);
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    }
    await supabase.from("push_notifications").insert({
      kind: "custom", title: c.title.trim(), body: c.body.trim(), url: `${SITE}${c.url}`, race_count: 0, error: sendError,
      topic, sent_by: caller.userId,
    });
    return json({ sent: [{ kind: "custom", topic, title: c.title, url: c.url, error: sendError }] }, sendError ? 502 : 200);
  }

  const { data: queue, error } = await supabase
    .from("push_queue")
    .select("id, kind, race_id, created_at")
    .is("sent_at", null)
    .order("created_at");
  if (error) return json({ error: error.message }, 500);
  if (!queue?.length) return json({ sent: [] });

  const report: unknown[] = [];
  let token: string | null = null;

  for (const kind of Object.keys(TOPIC) as Kind[]) {
    const rows = queue.filter((q) => q.kind === kind);
    if (!rows.length) continue;

    // Vague encore en cours : on attend la fin (sauf envoi manuel).
    const newest = new Date(rows[rows.length - 1].created_at).getTime();
    if (caller.kind === "cron" && Date.now() - newest < QUIET_MINUTES * 60_000) {
      report.push({ kind, waiting: rows.length });
      continue;
    }

    const ids = [...new Set(rows.map((r) => r.race_id))];
    const { data: races } = await supabase
      .from("races")
      .select("id, name, km, country")
      .in("id", ids)
      .eq("status", "published");
    const list = ((races || []) as Race[]).sort((a, b) => ids.indexOf(String(a.id)) - ids.indexOf(String(b.id)));

    const rowIds = rows.map((r) => r.id);
    if (!list.length) {
      // Fiches dépubliées entre-temps : rien à annoncer.
      await supabase.from("push_queue").update({ sent_at: new Date().toISOString() }).in("id", rowIds);
      report.push({ kind, skipped: rows.length });
      continue;
    }

    const msg = compose(kind, list);
    let sendError: string | null = null;
    try {
      token ??= await accessToken(sa);
      await sendToTopic(sa, token, TOPIC[kind], msg.title, msg.body, msg.url);
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    }

    await supabase.from("push_notifications").insert({
      kind, title: msg.title, body: msg.body, url: `${SITE}${msg.url}`, race_count: list.length, error: sendError,
      topic: TOPIC[kind], sent_by: caller.userId,
    });
    // En cas d'échec, la file reste en attente et sera retentée au prochain passage.
    if (!sendError) {
      await supabase.from("push_queue").update({ sent_at: new Date().toISOString() }).in("id", rowIds);
    }
    report.push({ kind, races: list.length, title: msg.title, error: sendError });
  }

  return json({ sent: report });
});
