import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { trackEvent } from "../lib/analytics";
import { t, tn, LangSwitch } from "../lib/i18n";

// Page « Mes liens » pour la bio Instagram / Facebook.
// URL à mettre en bio (les paramètres utm_ servent à GA4) :
//   Instagram : https://ultraride.eu/liens?utm_source=instagram&utm_medium=social&utm_campaign=bio
//   Facebook  : https://ultraride.eu/liens?utm_source=facebook&utm_medium=social&utm_campaign=bio
// Chaque clic envoie l'événement GA4 « bio_link_click » (link_id, source),
// une inscription envoie « newsletter_signup » — seulement si le visiteur a accepté les cookies.

const APP_STORE = "https://apps.apple.com/app/id6831256325";
const GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=eu.ultraride.app";

const LINKS = [
  { id: "ultras", to: "/ultras", title: "Trouve ton prochain ultra", sub: "Route, gravel, VTT : tout le calendrier" },
  { id: "carte", to: "/carte", title: "La carte des départs", sub: "Les ultras près de chez toi" },
  { id: "passeport", to: "/account", title: "Ton Passeport Ultra", sub: "Ton palmarès à partir de tes .fit" },
  { id: "organisateur", to: "/login?mode=signup", title: "Tu organises un ultra ?", sub: "Crée ta fiche, traduite en anglais automatiquement" },
  { id: "proposer", to: "/proposer-course", title: "Proposer un ultra", sub: "Un ultra manque ? Dis-le-nous" },
  { id: "projet", to: "/le-projet", title: "Le projet UltraRide", sub: "Qui on est, pourquoi on le fait" },
];

const SOURCE_KEY = "ur-bio-source";

function readSource() {
  try {
    const q = new URLSearchParams(window.location.search).get("utm_source");
    if (q) {
      const clean = q.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
      sessionStorage.setItem(SOURCE_KEY, clean);
      return clean;
    }
    return sessionStorage.getItem(SOURCE_KEY) || "direct";
  } catch {
    return "direct";
  }
}

export default function Links() {
  const [source] = useState(readSource);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState({ status: "idle", msg: "" });
  const [count, setCount] = useState(null);

  useEffect(() => {
    supabase
      .from("races")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("is_current", true)
      .then(({ count: n }) => { if (n) setCount(n); });
  }, []);

  useEffect(() => {
    document.title = t("UltraRide — liens");
    // Fond parchemin jusqu'en bas de l'écran.
    const prev = document.body.style.background;
    document.body.style.background = "#F5F1E6";
    return () => { document.body.style.background = prev; };
  }, []);

  const click = (id) => () => trackEvent("bio_link_click", { link_id: id, source });

  const subscribe = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setState({ status: "error", msg: t("Vérifie ton adresse e-mail.") });
      return;
    }
    if (!consent) {
      setState({ status: "error", msg: t("Coche la case pour recevoir la newsletter.") });
      return;
    }
    setState({ status: "sending", msg: "" });
    const { error } = await supabase
      .from("newsletter_signups")
      .insert({ email: value, consent: true, source: "liens", utm_source: source });
    if (error) {
      setState({ status: "error", msg: t("L'inscription n'a pas fonctionné. Réessaie dans un instant.") });
      return;
    }
    trackEvent("newsletter_signup", { source, method: "bio" });
    setEmail("");
    setConsent(false);
    setState({ status: "done", msg: t("C'est noté ! Tu recevras les nouveautés UltraRide.") });
  };

  return (
    <main className="lk">
      <style>{CSS}</style>
      <div className="lk-wrap">
        <div className="lk-lang"><LangSwitch /></div>
        <header className="lk-head">
          <div className="lk-logo" aria-label="UltraRide">
            <span className="u">U</span><span className="r">R</span>
          </div>
          <h1>Ultra<em>Ride</em></h1>
          <p>{t("Le calendrier des ultras vélo en Europe")}</p>
          {count && <p className="lk-count">{tn(count, "{n} ultra", "{n} ultras")} · {t("route, gravel, VTT")}</p>}
        </header>

        <section className="lk-app" aria-label={t("L'app UltraRide")}>
          <span className="lk-kicker">{t("L'app UltraRide · FR / EN")}</span>
          <p className="lk-app-sub">{t("Gratuite, en français et en anglais. Les descriptions des ultras sont traduites dans la fiche.")}</p>
          <div className="lk-stores">
            <a href={APP_STORE} target="_blank" rel="noopener noreferrer" onClick={click("app_store")}>
              <small>{t("Télécharger sur")}</small>App Store
            </a>
            <a href={GOOGLE_PLAY} target="_blank" rel="noopener noreferrer" onClick={click("google_play")}>
              <small>{t("Disponible sur")}</small>Google Play
            </a>
          </div>
        </section>

        <nav className="lk-list" aria-label={t("Liens UltraRide")}>
          {LINKS.map((l) => (
            <Link key={l.id} to={l.to} onClick={click(l.id)}>
              <b>{t(l.title)}</b>
              <span>{t(l.sub)}</span>
              <i aria-hidden="true">→</i>
            </Link>
          ))}
        </nav>

        <form className="lk-news" onSubmit={subscribe} noValidate>
          <label htmlFor="lk-email" className="lk-kicker">{t("La newsletter")}</label>
          <p>{t("Les nouveaux ultras et les ouvertures d'inscriptions, dans ta boîte mail.")}</p>
          <div className="lk-row">
            <input
              id="lk-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("ton@email.fr")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state.status === "sending"}
            />
            <button type="submit" disabled={state.status === "sending"}>
              {state.status === "sending" ? "…" : t("Je m'inscris")}
            </button>
          </div>
          <label className="lk-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              {t("J'accepte de recevoir la newsletter d'UltraRide. Désinscription en un clic.")}{" "}
              <Link to="/confidentialite">{t("Confidentialité")}</Link>
            </span>
          </label>
          {state.msg && (
            <p className={`lk-msg ${state.status === "done" ? "ok" : "ko"}`} role="status">{state.msg}</p>
          )}
        </form>

        <footer className="lk-foot">
          <a href="mailto:hello@ultraride.eu" onClick={click("contact")}>hello@ultraride.eu</a>
          <span>·</span>
          <Link to="/" onClick={click("site")}>ultraride.eu</Link>
        </footer>
      </div>
    </main>
  );
}

const CSS = `
.lk{min-height:100dvh;background:#F5F1E6;color:#1B2B20;font-family:'IBM Plex Sans',sans-serif;padding:36px 16px 48px;box-sizing:border-box}
.lk *{box-sizing:border-box}
.lk-wrap{max-width:460px;margin:0 auto;display:flex;flex-direction:column;gap:22px}
.lk-head{text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px}
.lk-logo{width:76px;height:76px;border-radius:20px;background:#0B0B0B;display:flex;align-items:center;justify-content:center;font-family:Anton,sans-serif;font-size:44px;line-height:1;box-shadow:0 10px 24px rgba(27,43,32,.25);margin-bottom:6px}
.lk-logo .u{color:#E8732F}.lk-logo .r{color:#23A85C}
.lk-head h1{font-family:Anton,sans-serif;font-weight:400;font-size:40px;text-transform:uppercase;margin:0;letter-spacing:.01em;color:#1B2B20}
.lk-head h1 em{font-style:normal;color:#C4622D}
.lk-head p{margin:0;color:#5E6A5F;font-size:15px}
.lk-head .lk-count{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#C4622D;margin-top:2px}
.lk-lang{display:flex;justify-content:flex-end;margin-bottom:-14px}
.lk-app-sub{margin:-4px 0 12px;color:#CFC8B8;font-size:14px;line-height:1.45}
.lk-kicker{display:block;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#E8925A;margin-bottom:10px}
.lk-app{background:#1B2B20;border-radius:18px;padding:16px}
.lk-stores{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.lk-stores a{display:block;background:#0B0B0B;color:#F5F1E6;text-decoration:none;border:1px solid #3A4D40;border-radius:12px;padding:10px 12px;font-weight:600;font-size:17px;line-height:1.15}
.lk-stores a small{display:block;font-weight:400;font-size:11px;opacity:.75}
.lk-stores a:hover{border-color:#E8925A}
.lk-list{display:flex;flex-direction:column;gap:10px}
.lk-list a{position:relative;display:block;background:#1B2B20;color:#F5F1E6;text-decoration:none;border-radius:14px;padding:14px 46px 14px 16px;transition:transform .12s;box-shadow:0 6px 16px rgba(27,43,32,.12)}
.lk-list a:hover{transform:translateY(-1px)}
.lk-list a b{display:block;font-family:Anton,sans-serif;font-weight:400;font-size:21px;text-transform:uppercase;letter-spacing:.01em}
.lk-list a span{display:block;color:#BDB6A6;font-size:14px;margin-top:2px}
.lk-list a i{position:absolute;right:16px;top:50%;transform:translateY(-50%);font-style:normal;font-size:22px;color:#E8925A}
.lk-news{background:#1B2B20;border-radius:18px;padding:16px}
.lk-news p{margin:0 0 12px;color:#CFC8B8;font-size:15px}
.lk-row{display:flex;gap:8px}
.lk-row input{flex:1;min-width:0;font:inherit;font-size:16px;padding:11px 12px;border-radius:10px;border:1px solid #3A4D40;background:#F5F1E6;color:#1B2B20}
.lk-row button{font:inherit;font-weight:600;font-size:15px;border:0;border-radius:10px;padding:0 14px;background:#C4622D;color:#fff;cursor:pointer;white-space:nowrap}
.lk-row button:disabled{opacity:.6}
.lk-consent{display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:13px;color:#BDB6A6;line-height:1.45}
.lk-consent input{width:18px;height:18px;margin-top:1px;flex:none;accent-color:#C4622D}
.lk-consent a{color:#E8925A}
.lk-msg{margin:10px 0 0 !important;font-size:14px}
.lk-msg.ok{color:#7DD39C !important}.lk-msg.ko{color:#F09A8A !important}
.lk-foot{display:flex;justify-content:center;gap:8px;font-family:'IBM Plex Mono',monospace;font-size:13px;color:#8A8F80}
.lk-foot a{color:#5E6A5F;text-decoration:none}
.lk :focus-visible{outline:2px solid #C4622D;outline-offset:2px}
`;
