import { isNative, platform } from "../lib/native";
import { isEn, t } from "../lib/i18n";

// Bouton « Translate » sous les descriptions des ultras (écrites en français).
// Affiché seulement quand l'interface est en anglais.
// - Android (app) : feuille de partage du téléphone, d'où l'on choisit
//   Google Traduction (ou toute autre app de traduction installée).
// - iPhone (app) et navigateur : Google Traduction, qui s'ouvre dans l'app
//   si elle est installée, sinon dans le navigateur.
// Langue cible : celle du téléphone si ce n'est pas le français, sinon l'anglais.

const MAX = 4500; // au-delà, Google Traduction coupe le texte passé dans l'adresse

function targetLang() {
  const nav = (navigator.languages?.[0] || navigator.language || "en").slice(0, 2).toLowerCase();
  return nav && nav !== "fr" ? nav : "en";
}

export function translateUrl(text) {
  const q = encodeURIComponent(String(text).slice(0, MAX));
  return `https://translate.google.com/?sl=fr&tl=${targetLang()}&text=${q}&op=translate`;
}

export default function TranslateButton({ text, className = "", style }) {
  if (!text || !isEn()) return null;

  const onClick = async (e) => {
    if (!(isNative && platform === "android")) return; // le lien fait le travail
    e.preventDefault();
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ text: String(text), dialogTitle: t("Traduire avec…") });
    } catch {
      window.open(translateUrl(text), "_blank", "noopener");
    }
  };

  return (
    <a
      href={translateUrl(text)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`translate-btn ${className}`.trim()}
      style={style}
      lang="en"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5h9M8.5 3v2M6 5c.8 3.5 3 6 6 7.5M11 5c-.8 3.6-3.4 6.4-7 8" />
        <path d="m12.5 21 4-9 4 9M14 18h5" />
      </svg>
      {t("Traduire la description")}
    </a>
  );
}
