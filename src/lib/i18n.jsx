import { createContext, useContext, useEffect, useState } from "react";
import EN from "./i18n.en.js";

// Traduction de l'interface FR / EN.
// Le texte français sert de clé : t("Trouve ton prochain ultra") renvoie
// la version anglaise si la langue active est « en » et que la phrase est
// dans le dictionnaire ; sinon le français s'affiche (repli sans casse).
// Variables : t("{n} ultras", { n: 12 }).
// La langue suit le téléphone / navigateur (français → FR, sinon EN),
// puis le choix fait dans le sélecteur, mémorisé sous « ur-lang ».

const KEY = "ur-lang";
export const LANGS = ["fr", "en"];

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* stockage indisponible */ }
  const nav = (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || "fr";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current = detect();
const listeners = new Set();

export function getLang() { return current; }
export function isEn() { return current === "en"; }

/** Locale Intl correspondant à la langue active (dates, nombres). */
export function locale() { return current === "en" ? "en-GB" : "fr-FR"; }

export function setLang(lang) {
  if (!LANGS.includes(lang) || lang === current) return;
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn(lang));
}

function fill(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? vars[k] === 0 ? String(vars[k]) : m));
}

/** Traduit une phrase française. */
export function t(fr, vars) {
  if (fr == null) return fr;
  const s = current === "en" ? (EN[fr] ?? fr) : fr;
  return fill(s, vars);
}

/** Choisit entre deux formes selon le nombre : tn(n, "{n} ultra", "{n} ultras"). */
export function tn(n, one, many, vars) {
  const key = Math.abs(Number(n)) > 1 ? many : one;
  return t(key, { n, ...vars });
}

const LangContext = createContext("fr");

export function LangProvider({ children }) {
  const [lang, set] = useState(current);
  useEffect(() => {
    document.documentElement.lang = current;
    listeners.add(set);
    return () => listeners.delete(set);
  }, []);
  // La clé force le remontage de l'app : tous les textes sont recalculés.
  return <LangContext.Provider value={lang}><div key={lang} style={{ display: "contents" }}>{children}</div></LangContext.Provider>;
}

export function useLang() { return useContext(LangContext); }

/** Petit sélecteur FR / EN. */
export function LangSwitch({ className = "", style }) {
  const lang = useLang();
  return (
    <div className={`lang-switch ${className}`} style={style} role="group" aria-label={t("Langue")}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          className={lang === l ? "on" : ""}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Table de libellés traduits à la lecture : trObj({ a: "Boucle" }).a → "Loop" en anglais. */
export function trObj(obj) {
  return new Proxy(obj, { get: (o, k) => (typeof o[k] === "string" ? t(o[k]) : o[k]) });
}
