import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isEn, t } from "../lib/i18n";

// Description d'un ultra (écrite en français par l'organisateur).
// En anglais, la traduction enregistrée (long_blurb_en / blurb_en / terrain_en)
// s'affiche directement, avec un lien pour revoir le français.
// S'il n'y a pas encore de traduction : bouton « Translate » qui la demande
// à l'Edge Function translate-race (enregistrée pour les visiteurs suivants).

/** Texte court d'une carte, dans la langue de l'interface. */
export function raceBlurb(race) {
  if (!race) return "";
  return (isEn() && race.blurb_en) || race.blurb || "";
}

const Icon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5h9M8.5 3v2M6 5c.8 3.5 3 6 6 7.5M11 5c-.8 3.6-3.4 6.4-7 8" />
    <path d="m12.5 21 4-9 4 9M14 18h5" />
  </svg>
);

export default function RaceDescription({ race, textClassName, showTerrain = false, terrainClassName = "muted", terrainStyle }) {
  const [fetched, setFetched] = useState(null); // traduction obtenue sur place
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const fr = race.long_blurb || race.blurb;
  if (!fr) return null;

  const en = fetched || race;
  const enText = race.long_blurb ? en.long_blurb_en : en.blurb_en;
  const enTerrain = race.terrain ? en.terrain_en : null;
  const english = isEn();
  const showEn = english && !!enText && !original;

  const translate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { data, error } = await supabase.functions.invoke("translate-race", { body: { race_id: race.id } });
      if (error || !data || data.error) throw error || new Error(data?.error);
      setFetched(data);
      setOriginal(false);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  const text = showEn ? enText : fr;
  const terrain = showEn ? (enTerrain || race.terrain) : race.terrain;

  return (
    <>
      <p className={textClassName} lang={showEn ? "en" : "fr"}>{text}</p>
      {showTerrain && terrain && (
        <p className={terrainClassName} style={{ margin: 0, fontSize: 15, ...terrainStyle }} lang={showEn ? "en" : "fr"}>
          {t("Terrain : {x}", { x: terrain })}
        </p>
      )}
      {english && (
        <div className="race-desc-tools">
          {enText ? (
            <>
              {showEn && !race.en_reviewed && !fetched?.reviewed && (
                <span className="race-desc-note"><Icon />{t("Traduit automatiquement")}</span>
              )}
              <button type="button" className="race-desc-link" onClick={() => setOriginal((o) => !o)}>
                {original ? t("Voir la traduction") : t("Voir l'original (français)")}
              </button>
            </>
          ) : (
            <button type="button" className="translate-btn" onClick={translate} disabled={busy}>
              <Icon />{busy ? t("Traduction…") : t("Traduire la description")}
            </button>
          )}
          {failed && <span className="race-desc-note">{t("Traduction indisponible, réessaie plus tard.")}</span>}
        </div>
      )}
    </>
  );
}
