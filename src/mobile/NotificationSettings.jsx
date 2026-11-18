import { useEffect, useState } from "react";
import { isNative } from "../lib/native";
import { TOPICS, getPushPrefs, setPushPrefs, pushPermission, pushInviteSeen, markPushInviteSeen } from "../lib/push";
import { MenuButton } from "./ui";
import { t } from "../lib/i18n";

// Interrupteurs « Nouveaux ultras » / « Ultras mis à jour » (app seulement).
export function NotificationSettings() {
  const [prefs, setPrefs] = useState(getPushPrefs);
  const [perm, setPerm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  useEffect(() => { pushPermission().then(setPerm); }, []);

  if (!isNative) return <p className="m-note">{t("Les notifications sont disponibles dans l'app UltraRide.")}</p>;

  const toggle = async (key) => {
    setBusy(true);
    setFailure(null);
    try {
      setPrefs(await setPushPrefs({ ...prefs, [key]: !prefs[key] }));
      setPerm("granted");
    } catch (e) {
      // Refus de l'utilisateur, ou autorisation accordée mais inscription
      // Firebase / Apple en échec : on distingue les deux cas.
      const p = await pushPermission();
      setPerm(p);
      if (!(p === "denied" && e?.message === "denied")) setFailure(e?.message || String(e));
      setPrefs({ newRaces: false, updates: false });
    }
    setBusy(false);
  };

  return (
    <div className="m-card m-list">
      {Object.entries(TOPICS).map(([key, topic]) => (
        <label key={key} className="m-switchrow">
          <span className="m-row-body">
            <span className="m-row-title">{t(topic.label)}</span>
            <span className="m-switch-hint">{t(topic.hint)}</span>
          </span>
          <input type="checkbox" className="m-switch" checked={!!prefs[key]} disabled={busy} onChange={() => toggle(key)} />
        </label>
      ))}
      {failure && (
        <p className="m-note m-note--warn">
          {t("L'inscription aux notifications n'a pas abouti. Réessaie dans un instant.")}
          <br /><small style={{ opacity: 0.7 }}>{t("Détail : {d}", { d: failure })}</small>
        </p>
      )}
      {perm === "denied" && (
        <p className="m-note m-note--warn">
          {t("Les notifications sont bloquées pour UltraRide. Autorise-les dans les réglages du téléphone, puis réessaie.")}
        </p>
      )}
    </div>
  );
}

// Écran /notifications, accessible depuis le menu de l'app.
export function NotificationsScreen() {
  return (
    <div className="m-screen">
      <div className="m-pad m-stack">
        <div className="m-topbar">
          <h1 className="m-h1 m-h1--page">{t("NOTIFICATIONS")}</h1>
          <MenuButton />
        </div>
        <p className="m-note">{t("Une seule notification par vague : jamais une alerte par fiche.")}</p>
        <NotificationSettings />
      </div>
    </div>
  );
}

// Invitation unique : un panneau monte du bas 20 s après la première
// ouverture de l'app, sur n'importe quel écran. La fenêtre système
// (iOS / Android) n'est demandée que si la personne touche « Activer ».
const INVITE_DELAY_MS = 20000;

export function NotificationInvite() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNative || pushInviteSeen()) return;
    const timer = setTimeout(() => {
      if (pushInviteSeen()) return;
      pushPermission().then((p) => { if (p === "prompt") setShow(true); });
    }, INVITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  const close = () => { markPushInviteSeen(); setShow(false); };
  const accept = async () => {
    setBusy(true);
    try { await setPushPrefs({ newRaces: true, updates: true }); } catch { /* refusé : rien de plus */ }
    close();
  };

  return (
    // Pas de fermeture en touchant à côté : l'invitation ne s'affiche qu'une fois,
    // l'utilisateur doit choisir explicitement « Activer » ou « Plus tard ».
    <div className="m-sheet-backdrop" role="presentation">
      <div className="m-sheet" role="dialog" aria-modal="true" aria-labelledby="push-invite-title">
        <div className="m-sheet-head">
          <strong id="push-invite-title" className="m-row-title">{t("Rester au courant des ultras ?")}</strong>
        </div>
        <p className="m-note" style={{ margin: 0 }}>
          {t("Une notification quand un nouvel ultra arrive dans l'annuaire, ou quand des fiches changent : dates, parcours, inscriptions. Une seule par vague, jamais une par fiche. Modifiable à tout moment dans le menu, rubrique Notifications.")}
        </p>
        <div className="m-sheet-foot m-sheet-foot--stack">
          <button type="button" className="m-btn m-btn--dark" onClick={accept} disabled={busy}>{t("Activer les notifications")}</button>
          <button type="button" className="m-btn m-btn--ghost" onClick={close} disabled={busy}>{t("Plus tard")}</button>
        </div>
      </div>
    </div>
  );
}
