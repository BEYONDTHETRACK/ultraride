import { supabase } from "./supabaseClient";

const BOT_RE = /bot|crawl|spider|slurp|preview|lighthouse|headless|facebookexternalhit|embedly|whatsapp|telegram|discord|google-inspectiontool|gptbot|claude|perplexity|bytespider|ahrefs|semrush|mj12/i;

// Catégorie du robot (seule la catégorie est envoyée, jamais l'user-agent).
const KINDS = [
  ["ia", /gptbot|chatgpt|oai-searchbot|claude|anthropic|perplexity|ccbot|bytespider|amazonbot|meta-externalagent|cohere|youbot|diffbot/i],
  ["google", /google/i],
  ["bing", /bingbot|bingpreview|msnbot|adidxbot/i],
  ["social", /facebookexternalhit|meta-externalfetcher|facebookcatalog|whatsapp|telegram|discord|slack|twitterbot|linkedinbot|pinterest|embedly|skype|redditbot|preview/i],
  ["seo", /ahrefs|semrush|mj12|dotbot|rogerbot|screaming|seokicks|serpstat|dataforseo|blexbot/i],
  ["moteurs", /applebot|yandex|duckduck|baidu|qwant|seznam|sogou|petalbot|ecosia|mojeek/i],
  ["automatise", /headless|lighthouse|puppeteer|playwright|selenium|phantom/i],
];
function botKind(ua) {
  for (const [k, re] of KINDS) if (re.test(ua)) return k;
  return navigator.webdriver === true ? "automatise" : "autre";
}

// Compte une visite par session de navigation (onglet), sans cookie ni donnée personnelle.
// Les robots sont comptés séparément.
export function trackVisit() {
  try {
    const isBot = navigator.webdriver === true || BOT_RE.test(navigator.userAgent || "");
    const key = isBot ? "ur_visit_bot" : "ur_visit";
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    supabase.rpc("track_visit", { p_bot: isBot }).then(() => {}, () => {});
    if (isBot) supabase.rpc("track_bot_kind", { p_kind: botKind(navigator.userAgent || "") }).then(() => {}, () => {});
  } catch (_) {}
}
