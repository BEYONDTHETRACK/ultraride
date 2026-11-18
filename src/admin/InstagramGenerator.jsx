import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getFlagEmoji } from "../lib/emea";
import EN from "../lib/i18n.en";

// Vignette Instagram 4:5. Tout est dessiné en Canvas 2D natif : aucune
// dépendance, et le PNG exporté a la résolution réelle (1080 × 1350).
const W = 1080;
const H = 1350;

const COLORS = {
  parchment: "#F5F1E6",
  imageBg: "#E8DFC8",
  card: "#FFFFFF",
  line: "#DDD5BE",
  ink: "#1B2B20",
  dim: "#6B6F60",
  blurb: "#4A4D42",
  moss: "#15793F",
  rust: "#C4622D",
  brick: "#B8432E",
  // Équivalents opaques des badges .badge-published / .badge-rejected sur fond blanc.
  openBg: "#C5DECF",
  closedBg: "#F1D9D5",
  cream: "#EFE8D0",
  amber: "#F0A43A",
};

// Icône de l'app (U orange, R vert sur fond noir), servie par le site.
const APP_ICON_URL = "/ig-app-icon.png";

const DISP = "Anton, sans-serif";
const SANS = "'IBM Plex Sans', sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const EMOJI = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

const FORMAT_LABEL = { course: "Course", aventure: "Aventure", endurance: "Endurance" };

// Fond de la moitié basse : une couleur par pratique (Route = vert foncé,
// Gravel = vert, VTT = rouille). Texte crème dans tous les cas.
export const FRAMES = {
  dark: { label: "Vert foncé", bg: "#1B2B20" },
  green: { label: "Vert", bg: "#15793F" },
  rust: { label: "Rouille", bg: "#9E4A20" },
};
export const FRAME_BY_DISCIPLINE = { Route: "dark", Gravel: "green", VTT: "rust" };

function normalize(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function slugify(str) {
  return normalize(str).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ultra";
}

// Espace classique plutôt que l'espace fine insécable de toLocaleString,
// absente de certaines polices : 14000 → "14 000".
function formatThousands(n) {
  if (n === null || n === undefined || n === "") return null;
  const num = Number(n);
  if (!Number.isFinite(num) || num === 0) return null;
  const [int, dec] = String(num).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (dec ? `,${dec}` : "");
}

const IG_RESERVED_PATHS = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts"]);

// "@nom", "nom", "https://instagram.com/nom", "https://www.instagram.com/nom/?hl=fr"
// → "@nom". null si la valeur est vide ou ne ressemble pas à un compte.
function toInstagramHandle(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  let handle;
  const fromUrl = v.match(/^(?:https?:\/\/)?(?:[a-z]+\.)?instagram\.com\/([^/?#]+)/i);
  if (fromUrl) {
    if (IG_RESERVED_PATHS.has(fromUrl[1].toLowerCase())) return null;
    handle = fromUrl[1];
  } else if (/[/:]/.test(v)) {
    return null;
  } else {
    handle = v.replace(/^@/, "");
  }
  handle = handle.toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? `@${handle}` : null;
}

function organizerName(race) {
  return race.organizer?.name || race.organizer_name || null;
}

/* ---------- utilitaires canvas ---------- */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function setLetterSpacing(ctx, px) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
}

function ellipsize(ctx, text, maxWidth) {
  let t = text.trimEnd();
  if (ctx.measureText(t + "…").width <= maxWidth) return t + "…";
  while (t.length > 0 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1).trimEnd();
  return t + "…";
}

// Découpe en lignes avec la police courante du contexte. Respecte les retours
// à la ligne du texte, coupe les mots trop longs, et termine par "…" si le
// texte dépasse maxLines. Renvoie { lines, truncated }.
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let truncated = false;
  const paragraphs = String(text || "").split(/\n+/).map((p) => p.trim()).filter(Boolean);

  outer: for (const para of paragraphs) {
    let current = "";
    for (const word of para.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        if (lines.length >= maxLines) { truncated = true; break outer; }
      }
      // Mot plus large que la ligne : on le coupe caractère par caractère.
      current = "";
      for (const ch of word) {
        if (ctx.measureText(current + ch).width > maxWidth && current) {
          lines.push(current);
          if (lines.length >= maxLines) { truncated = true; break outer; }
          current = ch;
        } else {
          current += ch;
        }
      }
    }
    if (current) {
      lines.push(current);
      if (lines.length >= maxLines) {
        truncated = paragraphs.indexOf(para) < paragraphs.length - 1;
        break;
      }
    }
  }

  if (truncated && lines.length) {
    lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1], maxWidth);
  }
  return { lines, truncated };
}

// Pastille arrondie avec texte centré. colors : { bg, fg, border, borderWidth,
// font, height, padX, radius, letterSpacing, shadow, align, emoji }. L'emoji
// optionnel suit le texte, dessiné avec une police emoji. Renvoie sa largeur.
function drawPill(ctx, text, x, y, colors) {
  const {
    bg, fg, border, borderWidth = 0, font, height, padX,
    radius = height / 2, letterSpacing = 0, shadow = false, align = "left", emoji = null, lead = null,
  } = colors;

  ctx.save();
  const emojiFont = `${Math.round(height * 0.44)}px ${EMOJI}`;
  ctx.font = emojiFont;
  const emojiW = emoji ? ctx.measureText(emoji).width + 8 : 0;
  const leadW = lead ? ctx.measureText(lead).width + 10 : 0;
  ctx.font = font;
  setLetterSpacing(ctx, letterSpacing);
  const textW = ctx.measureText(text).width;
  const w = Math.ceil(textW + emojiW + leadW + padX * 2);
  const left = align === "right" ? x - w : x;

  roundRect(ctx, left, y, w, height, radius);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border && borderWidth) {
    roundRect(ctx, left + borderWidth / 2, y + borderWidth / 2, w - borderWidth, height - borderWidth, radius);
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = border;
    ctx.stroke();
  }

  const m = ctx.measureText("H");
  const cap = m.actualBoundingBoxAscent || height * 0.35;
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
  }
  ctx.fillStyle = fg;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(text, left + padX + leadW, y + height / 2 + cap / 2);
  if (lead) {
    ctx.save();
    ctx.shadowColor = "transparent";
    setLetterSpacing(ctx, 0);
    ctx.font = emojiFont;
    ctx.textBaseline = "middle";
    ctx.fillText(lead, left + padX, y + height / 2 + 1);
    ctx.restore();
  }
  if (emoji) {
    ctx.shadowColor = "transparent";
    setLetterSpacing(ctx, 0);
    ctx.font = emojiFont;
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, left + padX + textW + 8, y + height / 2 + 1);
  }
  ctx.restore();
  return w;
}

// Dessine l'image entière dans le cadre, sans recadrage (souvent des logos).
function drawImageContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Vrai si les pixels visibles de l'image sont surtout clairs (logo blanc sur
// fond transparent, par ex.) : on la pose alors sur un fond sombre.
function isLightImage(img) {
  try {
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 48;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n += 1;
    }
    // Image presque entièrement transparente ou majoritairement claire.
    return n > 0 && sum / n > 200 && n < 48 * 48 * 0.9;
  } catch {
    return false;
  }
}

function drawImageCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

// crossOrigin = "anonymous" : si le serveur ne renvoie pas les en-têtes CORS,
// le chargement échoue (onerror) au lieu de « tainter » le canvas, et l'export
// reste possible. Une seconde tentative contourne un éventuel cache navigateur
// rempli sans en-têtes CORS par l'affichage normal du site.
const imageCache = new Map();

function loadImageOnce(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 15000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (!imageCache.has(url)) {
    const p = loadImageOnce(url).then((img) => {
      if (img) return img;
      const bust = `${url}${url.includes("?") ? "&" : "?"}ig=${Date.now()}`;
      return loadImageOnce(bust);
    });
    imageCache.set(url, p);
  }
  return imageCache.get(url);
}

let fontsPromise = null;
function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      document.fonts.load(`400 80px Anton`),
      document.fonts.load(`400 30px 'IBM Plex Sans'`),
      document.fonts.load(`600 30px 'IBM Plex Sans'`),
      document.fonts.load(`500 30px 'IBM Plex Mono'`),
      document.fonts.load(`600 30px 'IBM Plex Mono'`),
    ])
      .catch(() => {})
      .then(() => document.fonts.ready);
  }
  return fontsPromise;
}

/* ---------- rendu de la vignette ---------- */

function drawFallbackName(ctx, name, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setLetterSpacing(ctx, 1);
  let size = 88;
  let wrapped;
  do {
    ctx.font = `400 ${size}px ${DISP}`;
    wrapped = wrapText(ctx, (name || "").toUpperCase(), w - 80, 3);
    size -= 4;
  } while (wrapped.truncated && size >= 48);
  const lh = (size + 4) * 1.1;
  const top = y + h / 2 - ((wrapped.lines.length - 1) * lh) / 2;
  wrapped.lines.forEach((line, i) => ctx.fillText(line, x + w / 2, top + i * lh));
  ctx.restore();
}

export async function renderRacecard(canvas, race, frameKey = "dark") {
  const frame = FRAMES[frameKey] || FRAMES.dark;
  await loadFonts();
  const [image, logo, appIcon] = await Promise.all([
    loadImage(race.image_url),
    loadImage(race.organizer?.logo_url),
    loadImage(APP_ICON_URL),
  ]);

  // blockers : empêchent l'export (vignette incomplète). warnings : simple info.
  const blockers = [];
  const warnings = [];
  if (!race.image_url) blockers.push("Ajoute un visuel à l'ultra : la vignette en a besoin (au moins la moitié de la carte).");
  else if (!image) blockers.push("Le visuel de l'ultra n'a pas pu être chargé (CORS ou URL cassée).");
  if (!race.blurb?.trim()) blockers.push("Ajoute la description courte en français.");
  if (!race.blurb_en?.trim()) blockers.push("Ajoute la description courte en anglais (champ ci-dessous).");
  if (race.organizer?.logo_url && !logo) {
    warnings.push("Le logo de l'organisateur n'a pas pu être chargé : il n'apparaît pas à côté du nom.");
  }

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = frame.bg;
  ctx.fillRect(0, 0, W, H);

  const PAD = 60;
  const x0 = PAD;
  const innerW = W - PAD * 2;
  const right = W - PAD;

  // --- Visuel : la moitié haute de la carte, image entière ---
  const VIS_H = H / 2 + 5; // 680 px
  ctx.fillStyle = image && isLightImage(image) ? COLORS.ink : COLORS.imageBg;
  ctx.fillRect(0, 0, W, VIS_H);
  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, VIS_H);
    ctx.clip();
    drawImageContain(ctx, image, 0, 112, W, VIS_H - 112 - 20);
    ctx.restore();
  } else {
    drawFallbackName(ctx, race.name, 0, 112, W, VIS_H - 132);
  }

  // Badges posés sur le haut du visuel
  const pillY = 36;
  const pillStyle = {
    bg: COLORS.ink, fg: COLORS.cream, font: `600 21px ${MONO}`, height: 44, padX: 18, radius: 8, letterSpacing: 2.5,
  };
  let px = 40;
  const flag = getFlagEmoji(race.country);
  if (race.country || flag) {
    px += drawPill(ctx, (race.country || "").toUpperCase(), px, pillY, { ...pillStyle, lead: flag }) + 16;
  }
  const kind = [race.discipline, FORMAT_LABEL[race.format] || race.format].filter(Boolean).join(" · ").toUpperCase();
  const statusLabel = race.open ? "OUVERT · OPEN" : "FERMÉ · CLOSED";
  const statusW = drawPill(ctx, statusLabel, W - 40, pillY, {
    ...pillStyle,
    bg: race.open ? COLORS.amber : COLORS.brick,
    fg: race.open ? COLORS.ink : COLORS.cream,
    align: "right",
  });
  if (kind) {
    ctx.save();
    ctx.font = pillStyle.font;
    setLetterSpacing(ctx, pillStyle.letterSpacing);
    const kw = ctx.measureText(kind).width + pillStyle.padX * 2;
    ctx.restore();
    if (px + kw < W - 40 - statusW - 16) drawPill(ctx, kind, px, pillY, pillStyle);
  }

  // --- Logo organisateur + nom de l'ultra ---
  let y = VIS_H + 22;
  let tx = x0;
  const LOGO = 76;
  if (logo) {
    ctx.save();
    roundRect(ctx, x0, y, LOGO, LOGO, 16);
    ctx.fillStyle = isLightImage(logo) ? "#0A0A0A" : "#FFFFFF";
    ctx.fill();
    ctx.clip();
    drawImageCover(ctx, logo, x0, y, LOGO, LOGO);
    ctx.restore();
    roundRect(ctx, x0 + 2, y + 2, LOGO - 4, LOGO - 4, 14);
    ctx.strokeStyle = COLORS.cream;
    ctx.lineWidth = 4;
    ctx.stroke();
    tx = x0 + LOGO + 24;
  }
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "alphabetic";
  setLetterSpacing(ctx, 0.5);
  let titleSize = 80;
  let title;
  for (;;) {
    ctx.font = `400 ${titleSize}px ${DISP}`;
    title = wrapText(ctx, (race.name || "").toUpperCase(), right - tx, 1);
    if (!title.truncated || titleSize <= 50) break;
    titleSize -= 4;
  }
  const titleCap = ctx.measureText("H").actualBoundingBoxAscent || titleSize * 0.75;
  const titleBase = y + LOGO / 2 + titleCap / 2;
  ctx.fillText(title.lines[0] || "", tx, titleBase);
  ctx.restore();
  y += LOGO + 22;

  // --- Bande chiffres : distance, dénivelé, date ---
  const BAND_H = 146;
  const colW = innerW / 3;
  ctx.save();
  ctx.strokeStyle = "rgba(239,232,208,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y); ctx.lineTo(right, y);
  ctx.moveTo(x0, y + BAND_H); ctx.lineTo(right, y + BAND_H);
  ctx.moveTo(x0 + colW, y); ctx.lineTo(x0 + colW, y + BAND_H);
  ctx.moveTo(x0 + colW * 2, y); ctx.lineTo(x0 + colW * 2, y + BAND_H);
  ctx.stroke();
  ctx.restore();

  const year = race.start_date ? String(race.start_date).slice(0, 4) : null;
  const monthFr = race.month ? [race.month.toUpperCase(), year].filter(Boolean).join(" ") : null;
  const monthEn = race.month ? [EN[race.month] || race.month, year].filter(Boolean).join(" ") : null;
  const km = formatThousands(race.km);
  const dplus = formatThousands(race.dplus);
  const cells = [
    { label: "DISTANCE", value: km, unit: "KM" },
    { label: "DÉNIVELÉ · ELEVATION", value: dplus, unit: "M D+" },
    { label: "DATE", value: monthFr, sub: monthEn },
  ];
  cells.forEach((c, i) => {
    const cx = x0 + colW * i + (i ? 28 : 0);
    const maxW = colW - (i ? 40 : 12);
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.font = `500 18px ${MONO}`;
    setLetterSpacing(ctx, 2.5);
    ctx.fillStyle = COLORS.amber;
    ctx.fillText(c.label, cx, y + 40);
    setLetterSpacing(ctx, 0);
    ctx.fillStyle = "#FFFFFF";
    const base = y + 104;
    if (!c.value) {
      ctx.font = `400 56px ${DISP}`;
      ctx.fillText("—", cx, base);
    } else {
      let size = 58;
      ctx.font = `400 ${size}px ${DISP}`;
      const unitW = () => (c.unit ? (ctx.font = `400 ${Math.round(size * 0.55)}px ${DISP}`, ctx.measureText(c.unit).width + 10) : 0);
      for (;;) {
        ctx.font = `400 ${size}px ${DISP}`;
        const vw = ctx.measureText(c.value).width;
        if (vw + unitW() <= maxW || size <= 36) break;
        size -= 2;
      }
      ctx.font = `400 ${size}px ${DISP}`;
      ctx.fillText(c.value, cx, base);
      const vw = ctx.measureText(c.value).width;
      if (c.unit) {
        ctx.font = `400 ${Math.round(size * 0.55)}px ${DISP}`;
        ctx.fillText(c.unit, cx + vw + 10, base);
      }
    }
    if (c.sub) {
      ctx.font = `500 20px ${MONO}`;
      ctx.fillStyle = COLORS.cream;
      ctx.fillText(c.sub, cx, y + 134);
    }
    ctx.restore();
  });
  y += BAND_H + 28;

  // --- Pied : organisateur à gauche, marque + icône de l'app à droite ---
  const ICON = 80;
  const footerMid = H - 30 - ICON / 2;
  const footerTop = footerMid - ICON / 2 - 16;

  // --- Textes FR / EN : 30 px, partage des lignes disponibles ---
  const LH = 44;
  const GAP = 16;
  const labelW = 100;
  const textW = innerW - labelW;
  ctx.save();
  ctx.font = `400 30px ${SANS}`;
  const fr = race.blurb?.trim() || "";
  const en = race.blurb_en?.trim() || "";
  const need = (txt) => (txt ? wrapText(ctx, txt, textW, 10).lines.length : 0);
  const maxTotal = Math.max(0, Math.floor((footerTop - y - (fr && en ? GAP : 0)) / LH));
  const needFr = need(fr);
  const needEn = need(en);
  let linesEn = Math.min(needEn, Math.max(en ? 1 : 0, Math.floor(maxTotal / 2)));
  let linesFr = Math.min(needFr, maxTotal - linesEn);
  linesEn = Math.min(needEn, maxTotal - linesFr);
  const block = (txt, n, tag, flagEmoji) => {
    if (!txt || n <= 0) return;
    ctx.font = `400 30px ${SANS}`;
    ctx.fillStyle = COLORS.cream;
    ctx.textBaseline = "top";
    const { lines } = wrapText(ctx, txt, textW, n);
    lines.forEach((line, i) => ctx.fillText(line, x0 + labelW, y + i * LH));
    // étiquette drapeau + code langue
    ctx.font = `26px ${EMOJI}`;
    ctx.fillText(flagEmoji, x0, y + 6);
    const fw = ctx.measureText(flagEmoji).width;
    ctx.font = `600 20px ${MONO}`;
    ctx.fillStyle = COLORS.amber;
    ctx.fillText(tag, x0 + fw + 10, y + 10);
    y += lines.length * LH + GAP;
  };
  block(fr, linesFr, "FR", "🇫🇷");
  block(en, linesEn, "EN", "🇬🇧");
  ctx.restore();

  const orgName = organizerName(race);
  const orgHandle = toInstagramHandle(race.organizer?.instagram);
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = `400 40px ${DISP}`;
  setLetterSpacing(ctx, 2.4);
  const brandW = ctx.measureText("ULTRARIDE.EU").width;
  const iconX = right - ICON;
  ctx.fillStyle = COLORS.cream;
  ctx.textAlign = "right";
  ctx.fillText("ULTRARIDE.EU", iconX - 22, footerMid + 2);
  ctx.textAlign = "left";
  setLetterSpacing(ctx, 0);
  if (appIcon) {
    ctx.save();
    roundRect(ctx, iconX, footerMid - ICON / 2, ICON, ICON, 18);
    ctx.fillStyle = "#0A0A0A";
    ctx.fill();
    ctx.clip();
    ctx.drawImage(appIcon, iconX, footerMid - ICON / 2, ICON, ICON);
    ctx.restore();
    roundRect(ctx, iconX + 1.5, footerMid - ICON / 2 + 1.5, ICON - 3, ICON - 3, 17);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const leftMax = iconX - 22 - brandW - 30 - x0;
  const who = orgHandle || orgName;
  if (who && leftMax > 120) {
    ctx.font = `500 22px ${MONO}`;
    ctx.fillStyle = COLORS.cream;
    const lead = "Organisé par · Hosted by ";
    const leadW = ctx.measureText(lead).width;
    if (leadW + 80 <= leftMax) {
      ctx.fillText(lead, x0, footerMid);
      ctx.font = `600 22px ${MONO}`;
      ctx.fillStyle = COLORS.amber;
      const rest = leftMax - leadW;
      ctx.fillText(ctx.measureText(who).width > rest ? ellipsize(ctx, who, rest) : who, x0 + leadW, footerMid);
    } else {
      ctx.font = `600 22px ${MONO}`;
      ctx.fillStyle = COLORS.amber;
      ctx.fillText(ctx.measureText(who).width > leftMax ? ellipsize(ctx, who, leftMax) : who, x0, footerMid);
    }
  }
  ctx.restore();

  return { warnings, blockers };
}

/* ---------- légende ---------- */

export function buildCaption(race) {
  const handle = toInstagramHandle(race.organizer?.instagram);
  const tr = (v) => (v ? EN[v] || v : v);
  const km = formatThousands(race.km);
  const dplus = formatThousands(race.dplus);
  const year = race.start_date ? String(race.start_date).slice(0, 4) : null;
  const facts = (lang) => {
    const L = lang === "en" ? tr : (v) => v;
    const where = [
      L(race.country),
      km && `${km} km`,
      dplus && `${dplus} m D+`,
      race.month && [L(race.month), year].filter(Boolean).join(" "),
    ].filter(Boolean).join(" · ");
    const what = [L(race.discipline), L(race.mode)].filter(Boolean).join(" · ");
    return [where && `📍 ${where}`, what && `🚴 ${what}`].filter(Boolean).join("\n");
  };

  // Le @compte en tête notifie l'organisateur, qui peut repartager.
  const fr = ["🇫🇷", handle, race.blurb?.trim()].filter(Boolean).join(" ");
  const en = race.blurb_en?.trim() ? `🇬🇧 ${race.blurb_en.trim()}` : null;

  // 5 hashtags max (limite Instagram), #UltraRide en premier, puis selon la pratique.
  const isBrm = /\bBRM\b/i.test(race.name || "");
  const TAGS_BY_DISCIPLINE = {
    Route: ["#ultracycling", "#ultradistance", "#roadcycling", isBrm ? "#randonneuring" : "#longdistancecycling"],
    Gravel: ["#ultracycling", "#gravelbike", "#bikepacking", "#gravelcycling"],
    VTT: ["#bikepacking", "#mtb", "#mtbadventure", "#ultracycling"],
  };
  const tags = ["#UltraRide", ...(TAGS_BY_DISCIPLINE[race.discipline] || ["#ultracycling", "#ultradistance", "#bikepacking"])]
    .slice(0, 5).join(" ");

  const blocks = [
    [fr, facts("fr")].filter(Boolean).join("\n"),
    en && [en, facts("en")].filter(Boolean).join("\n"),
    // Sans compte Instagram, pas de ligne organisateur du tout.
    handle && `Organisé par · Hosted by ${handle}`,
    // Pas d'URL dans les légendes (non cliquable sur Instagram) : on renvoie à la bio.
    "👉 Toutes les infos · Full details : lien en bio · link in bio",
    tags,
  ];
  return blocks.filter(Boolean).join("\n\n");
}

/* ---------- suivi des publications ---------- */

const IG_FILTERS = [
  { key: "all", label: "Tous" },
  { key: "todo", label: "Pas encore publiés" },
  { key: "done", label: "Publiés" },
];

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "";
}

function PostPill({ post }) {
  if (post?.published_at) {
    return (
      <span className="ig-pill ig-pill-published" title={`Publié le ${formatDate(post.published_at)}`}>
        📸 Publié
      </span>
    );
  }
  if (post?.exported_at) {
    return (
      <span className="ig-pill ig-pill-exported" title={`Exporté le ${formatDate(post.exported_at)}`}>
        ⬇ Exporté
      </span>
    );
  }
  return null;
}

/* ---------- page ---------- */

export default function InstagramGenerator() {
  const [races, setRaces] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [includeUnpublished, setIncludeUnpublished] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [blockers, setBlockers] = useState([]);
  const [enInput, setEnInput] = useState("");
  const [enSaving, setEnSaving] = useState(false);
  const [enError, setEnError] = useState(null);
  const [enSaved, setEnSaved] = useState(false);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const [posts, setPosts] = useState({});
  const [igFilter, setIgFilter] = useState("todo");
  const [frameKey, setFrameKey] = useState(null);
  const [savingPost, setSavingPost] = useState(false);
  const [igInput, setIgInput] = useState("");
  const [igSaving, setIgSaving] = useState(false);
  const [igError, setIgError] = useState(null);
  const [igSaved, setIgSaved] = useState(false);
  const canvasRef = useRef(null);
  const renderSeq = useRef(0);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("races")
        .select("*, organizer:organizers!races_organizer_id_fkey(id, name, logo_url, instagram)")
        .order("name", { ascending: true });
      if (error) setError(error.message);
      else setRaces(data);
    })();
    (async () => {
      const { data, error } = await supabase.from("instagram_posts").select("*");
      if (error) setError(`Suivi Instagram indisponible : ${error.message}`);
      else setPosts(Object.fromEntries(data.map((p) => [p.race_id, p])));
    })();
  }, []);

  // Mise à jour locale immédiate, puis upsert. En cas d'échec, on revient à
  // l'état précédent et on affiche l'erreur. Seuls les champs passés sont
  // écrits : un export ne touche jamais published_at, et inversement.
  const savePost = async (raceId, fields) => {
    const previous = posts[raceId];
    const row = { race_id: raceId, ...fields, updated_at: new Date().toISOString() };
    setPosts((p) => ({ ...p, [raceId]: { ...p[raceId], ...row } }));
    const { error } = await supabase
      .from("instagram_posts")
      .upsert(row, { onConflict: "race_id" });
    if (error) {
      setPosts((p) => {
        const next = { ...p };
        if (previous) next[raceId] = previous;
        else delete next[raceId];
        return next;
      });
      setError(`Suivi Instagram non enregistré : ${error.message}`);
      return false;
    }
    return true;
  };

  const setPublished = async (published) => {
    if (!selected) return;
    setSavingPost(true);
    setError(null);
    await savePost(selected.id, { published_at: published ? new Date().toISOString() : null });
    setSavingPost(false);
  };

  const pool = useMemo(
    () => (races || []).filter((r) => includeUnpublished || r.status === "published"),
    [races, includeUnpublished]
  );

  const stats = useMemo(() => {
    let published = 0;
    let exported = 0;
    pool.forEach((r) => {
      if (posts[r.id]?.published_at) published += 1;
      else if (posts[r.id]?.exported_at) exported += 1;
    });
    return { published, exported, remaining: pool.length - published - exported };
  }, [pool, posts]);

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    const list = pool
      .filter((r) => !q || normalize(r.name).includes(q))
      .filter((r) => {
        const isPublished = !!posts[r.id]?.published_at;
        if (igFilter === "todo") return !isPublished;
        if (igFilter === "done") return isPublished;
        return true;
      });
    // Les ultras exportés mais pas encore publiés sont à publier en priorité.
    if (igFilter === "todo") {
      const exported = (r) => (posts[r.id]?.exported_at ? 0 : 1);
      return [...list].sort((a, b) => exported(a) - exported(b));
    }
    return list;
  }, [pool, posts, search, igFilter]);

  const selected = useMemo(
    () => races?.find((r) => r.id === selectedId) || null,
    [races, selectedId]
  );

  const selectedOrgId = selected?.organizer?.id || null;
  const selectedOrgInstagram = selected?.organizer?.instagram || "";
  useEffect(() => {
    setIgInput(selectedOrgInstagram);
    setIgError(null);
    setIgSaved(false);
  }, [selectedId, selectedOrgInstagram]);

  // Enregistre le compte sous sa forme normalisée (@nom) ; un champ vide
  // efface la valeur. Tous les ultras du même organisateur sont mis à jour
  // localement, ce qui redessine la vignette et la légende.
  const saveInstagram = async () => {
    if (!selectedOrgId) return;
    const raw = igInput.trim();
    const handle = raw ? toInstagramHandle(raw) : null;
    if (raw && !handle) {
      setIgError(`« ${raw} » n'est pas un compte Instagram valide.`);
      return;
    }
    setIgSaving(true);
    setIgError(null);
    setIgSaved(false);
    const { error } = await supabase
      .from("organizers")
      .update({ instagram: handle })
      .eq("id", selectedOrgId);
    setIgSaving(false);
    if (error) {
      setIgError(error.message);
      return;
    }
    setRaces((list) =>
      list.map((r) =>
        r.organizer?.id === selectedOrgId ? { ...r, organizer: { ...r.organizer, instagram: handle } } : r
      )
    );
    setIgSaved(true);
  };

  // Description anglaise de la vignette : enregistrée dans races.blurb_en.
  const selectedBlurbEn = selected?.blurb_en || "";
  useEffect(() => {
    setEnInput(selectedBlurbEn);
    setEnError(null);
    setEnSaved(false);
  }, [selectedId, selectedBlurbEn]);

  const saveBlurbEn = async () => {
    if (!selected) return;
    const value = enInput.trim() || null;
    setEnSaving(true);
    setEnError(null);
    setEnSaved(false);
    const { error } = await supabase.from("races").update({ blurb_en: value }).eq("id", selected.id);
    setEnSaving(false);
    if (error) {
      setEnError(error.message);
      return;
    }
    setRaces((list) => list.map((r) => (r.id === selected.id ? { ...r, blurb_en: value } : r)));
    setEnSaved(true);
  };

  // Couleur proposée : celle de la pratique de l'ultra. Modifiable à la main
  // avec les pastilles.
  const suggestedFrame = FRAME_BY_DISCIPLINE[selected?.discipline] || "dark";
  const currentFrame = frameKey || suggestedFrame;

  useEffect(() => {
    if (!selected || !canvasRef.current) return;
    const seq = ++renderSeq.current;
    setCaption(buildCaption(selected));
    setCopied(false);
    setRendering(true);
    setWarnings([]);
    setBlockers([]);
    renderRacecard(canvasRef.current, selected, currentFrame)
      .then((r) => { if (seq === renderSeq.current) { setWarnings(r.warnings); setBlockers(r.blockers); } })
      .catch((e) => { if (seq === renderSeq.current) setBlockers([`Erreur de rendu : ${e.message}`]); })
      .finally(() => { if (seq === renderSeq.current) setRendering(false); });
  }, [selected, currentFrame]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas || !selected || blockers.length) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) { setError("L'export PNG a échoué."); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ultraride-${slugify(selected.name)}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        // Après le lancement du téléchargement : un échec ici ne le bloque pas.
        setError(null);
        savePost(selected.id, { exported_at: new Date().toISOString() });
      }, "image/png");
    } catch (e) {
      setError(`Export impossible : ${e.message}`);
    }
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Impossible de copier dans le presse-papiers.");
    }
  };

  return (
    <div>
      <h1 className="h1">Vignettes Instagram</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="ig-gen">
        <div className="panel ig-gen-list">
          <div className="field">
            <label htmlFor="ig-search">Rechercher un ultra</label>
            <input
              id="ig-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nom de l'ultra…"
            />
          </div>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 12px" }}>
            <input
              type="checkbox"
              checked={includeUnpublished}
              onChange={(e) => setIncludeUnpublished(e.target.checked)}
            />
            Inclure les non publiés
          </label>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {IG_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`btn${igFilter === f.key ? " btn-primary" : ""}`}
                style={{ padding: "5px 10px", fontSize: 12 }}
                onClick={() => setIgFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {races !== null && (
            <div className="muted mono" style={{ fontSize: 11, marginBottom: 10 }}>
              {stats.published} publié{stats.published !== 1 ? "s" : ""} · {stats.exported} exporté
              {stats.exported !== 1 ? "s" : ""} · {stats.remaining} restant{stats.remaining !== 1 ? "s" : ""}
            </div>
          )}

          {races === null ? (
            <p className="muted">Chargement…</p>
          ) : filtered.length === 0 ? (
            <p className="muted">Aucun ultra ne correspond.</p>
          ) : (
            <>
              <div className="muted mono" style={{ fontSize: 11, marginBottom: 6 }}>
                {filtered.length} ultra{filtered.length !== 1 ? "s" : ""}
              </div>
              <div className="ig-gen-items">
                {filtered.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`ig-gen-item${r.id === selectedId ? " active" : ""}`}
                    onClick={() => { setSelectedId(r.id); setFrameKey(null); }}
                  >
                    <span>{getFlagEmoji(r.country) || ""} {r.name}</span>
                    <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {!toInstagramHandle(r.organizer?.instagram) && (
                        <span className="ig-missing" title="Compte Instagram de l'organisateur non renseigné">IG ?</span>
                      )}
                      <PostPill post={posts[r.id]} />
                      {r.status !== "published" && <span className="badge badge-draft">{r.status}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          {!selected && <p className="muted">Choisis un ultra dans la liste pour générer sa vignette.</p>}
          <div style={{ display: selected ? "block" : "none" }}>
            <canvas ref={canvasRef} width={W} height={H} className="ig-gen-canvas" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 0", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 13 }}>Fond :</span>
              {Object.entries(FRAMES).map(([key, f]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFrameKey(key)}
                  title={key === suggestedFrame ? `${f.label} (couleur de la pratique)` : f.label}
                  aria-pressed={currentFrame === key}
                  style={{
                    width: 30, height: 30, borderRadius: "50%", background: f.bg, cursor: "pointer",
                    border: currentFrame === key ? "3px solid var(--ink, #1B2B20)" : "1px solid #CFC6B0",
                    outline: currentFrame === key ? "2px solid #fff" : "none", outlineOffset: -5,
                  }}
                />
              ))}
              <span className="muted mono" style={{ fontSize: 11 }}>
                {FRAMES[currentFrame].label}{currentFrame === suggestedFrame ? " · couleur de la pratique" : ""}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0" }}>
              <button className="btn btn-primary" onClick={download} disabled={rendering || blockers.length > 0}>
                Télécharger PNG
              </button>
              <span className="muted mono" style={{ fontSize: 11 }}>
                {rendering ? "Rendu en cours…" : `${W} × ${H} px`}
              </span>
            </div>
            {blockers.map((b) => (
              <p key={b} className="field-hint" style={{ color: "var(--brick)", margin: "0 0 6px" }}>✕ {b}</p>
            ))}
            {selected && (
              <div className="field" style={{ maxWidth: 560, marginBottom: 12 }}>
                <label htmlFor="ig-blurb-en">Description courte en anglais 🇬🇧</label>
                <div className="field-hint" style={{ marginBottom: 6 }}>
                  🇫🇷 {selected.blurb || "—"} ({(selected.blurb || "").length} car.)
                </div>
                <textarea
                  id="ig-blurb-en"
                  rows={3}
                  value={enInput}
                  onChange={(e) => { setEnInput(e.target.value); setEnSaved(false); }}
                  placeholder="Short description in English"
                  disabled={enSaving}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                  <button
                    className="btn"
                    onClick={saveBlurbEn}
                    disabled={enSaving || enInput.trim() === selectedBlurbEn.trim()}
                  >
                    {enSaving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                  <span className={`field-hint${enInput.length > 120 ? " rf-over" : ""}`} style={{ margin: 0 }}>
                    {enInput.length} / 120 caractères conseillés (au-delà, le texte est coupé sur la vignette)
                  </span>
                </div>
                {enSaved && <div className="field-hint" style={{ color: "var(--moss)" }}>Enregistré ✓</div>}
                {enError && <div className="error-box" style={{ marginTop: 6 }}>{enError}</div>}
              </div>
            )}
            {selected && (
              <div style={{ marginBottom: 12 }}>
                {posts[selected.id]?.published_at ? (
                  <span className="mono" style={{ fontSize: 12, color: "var(--moss)" }}>
                    Publié le {formatDate(posts[selected.id].published_at)}{" "}
                    <button
                      type="button"
                      className="ig-link"
                      onClick={() => setPublished(false)}
                      disabled={savingPost}
                    >
                      annuler
                    </button>
                  </span>
                ) : (
                  <button className="btn" onClick={() => setPublished(true)} disabled={savingPost}>
                    ✓ Marquer comme publié sur Instagram
                  </button>
                )}
              </div>
            )}
            {selected && (
              <div className="field" style={{ maxWidth: 560, marginBottom: 12 }}>
                <label htmlFor="ig-org">Instagram de l'organisateur</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="ig-org"
                    value={igInput}
                    onChange={(e) => { setIgInput(e.target.value); setIgSaved(false); }}
                    placeholder="@tortour_ultracycling ou URL du profil"
                    disabled={!selectedOrgId || igSaving}
                  />
                  <button
                    className="btn"
                    onClick={saveInstagram}
                    disabled={!selectedOrgId || igSaving || igInput.trim() === selectedOrgInstagram.trim()}
                  >
                    {igSaving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>
                {!selectedOrgId && <div className="field-hint">Lie d'abord un organisateur à cet ultra.</div>}
                {igSaved && <div className="field-hint" style={{ color: "var(--moss)" }}>Enregistré ✓</div>}
                {igError && <div className="error-box" style={{ marginTop: 6 }}>{igError}</div>}
              </div>
            )}
            {warnings.map((w) => (
              <p key={w} className="field-hint" style={{ color: "var(--brick)", margin: "0 0 6px" }}>⚠ {w}</p>
            ))}

            <div className="field" style={{ marginTop: 16, maxWidth: 560 }}>
              <label htmlFor="ig-caption">Légende</label>
              <textarea
                id="ig-caption"
                rows={14}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            <button className="btn" onClick={copyCaption} style={{ marginTop: 8 }}>
              {copied ? "Copié ✓" : "Copier la légende"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
