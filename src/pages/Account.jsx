import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthContext";
import { disablePush } from "../lib/push";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordErrorMessage } from "../lib/passwordRules";
import PalmaresSection from "./PalmaresSection";
import SiteFooter from "../components/SiteFooter";
import { DateTile, Countdown } from "../components/RaceBits";
import { ThemeSegmented } from "../components/ThemeToggle";
import { formatNumber } from "../lib/raceDisplay";
import { t, trObj, locale, LangSwitch } from "../lib/i18n";

const ROLE_LABEL = trObj({ participant: "Participant", organizer: "Organisateur", admin: "Administrateur" });
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function initials(name, email) {
  const src = (name || email || "?").replace(/@.*/, "").replace(/[._-]+/g, " ").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function maskEmail(email) {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  return `${local.slice(0, Math.min(9, Math.max(1, local.length - 3)))}…@${domain}`;
}

// Carte « Passeport Ultra » en tête de page : identité et cumuls du palmarès.
function PassportCard({ profile, user, summary, isOrganizer }) {
  const since = profile?.created_at ? new Date(profile.created_at) : null;
  const name = profile?.display_name || user.email.split("@")[0];
  const finishers = summary?.count || 0;
  return (
    <section className="acc-passport" aria-label={t("Mon passeport")}>
      <svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
        {[270, 225, 180, 135].map((y, i) => (
          <path key={y} d={`M-20 ${y} C 200 ${y - 50}, ${380 + i * 20} ${y + 20}, ${620 + i * 20} ${y - 30} S ${1000 + i * 10} ${y - 120}, 1220 ${y - 80}`} stroke="#2C4434" strokeWidth="1.4" />
        ))}
      </svg>
      <div className="acc-passport-inner">
        <div className="acc-passport-id">
          <div className="acc-avatar" aria-hidden="true">{initials(profile?.display_name, user.email)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span className="acc-passport-tag">{isOrganizer ? t("ESPACE ORGANISATEUR") : t("PASSEPORT ULTRA")}</span>
            <h1 className="acc-passport-name">{name}</h1>
            <span className="acc-passport-sub">
              {[ROLE_LABEL[profile?.role] || t("Participant"), since ? t("membre depuis {d}", { d: since.toLocaleDateString(locale(), { month: "long", year: "numeric" }) }) : null].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        {!isOrganizer && (
          <div className="acc-passport-right">
            <div className="acc-passport-stats">
              <div><b>{finishers}</b><span>{finishers !== 1 ? t("ULTRAS") : t("ULTRA")}</span></div>
              <div><b>{formatNumber(summary?.km || 0)}</b><span>KM</span></div>
              <div><b>{formatNumber(summary?.dplus || 0)}</b><span>M D+</span></div>
              <div><b>{summary?.countries || 0}</b><span>{t("PAYS")}</span></div>
            </div>
            {finishers > 0 && (
              <div className="acc-stamp"><span>FINISHER</span><span>×{finishers}</span></div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function InfoSection() {
  const { user, profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [marketingConsent, setMarketingConsent] = useState(profile?.marketing_consent ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || "");
    setMarketingConsent(profile?.marketing_consent || false);
  }, [profile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, marketing_consent: marketingConsent })
      .eq("id", user.id)
      .select();
    setSaving(false);
    if (error) setError(error.message);
    else if (!data || data.length === 0) setError(t("Aucune ligne mise à jour."));
    else {
      setSaved(true);
      refreshProfile();
    }
  };

  return (
    <section id="infos" className="acc-card acc-form" aria-labelledby="h-infos">
      <h2 id="h-infos" className="acc-h3">{t("Mes informations")}</h2>
      {error && <div className="error-box">{error}</div>}
      {saved && <div className="success-box">{t("Enregistré.")}</div>}
      <form onSubmit={handleSubmit} className="acc-form-body">
        <label className="acc-field">{t("Nom affiché")}
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("Ton nom ou pseudo")} />
        </label>
        <div className="acc-field"><span>{t("E-mail")}</span><span className="acc-static" title={user.email}>{maskEmail(user.email)}</span></div>
        <label className="acc-check">
          <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} />
          <span>{t("Recevoir les nouveautés d'UltraRide par e-mail (nouveaux ultras, ouvertures d'inscriptions).")}</span>
        </label>
        <div className="acc-field">
          <span>{t("Apparence")}</span>
          <ThemeSegmented className="acc-theme" />
        </div>
        <div className="acc-field">
          <span>{t("Langue")}</span>
          <LangSwitch />
        </div>
        <button className="v2-btn v2-btn-ink acc-btn" type="submit" disabled={saving}>
          {saving ? t("Enregistrement…") : t("Enregistrer")}
        </button>
      </form>
    </section>
  );
}

export function PasswordSection() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error } = await updatePassword(password);
    setSaving(false);
    if (error) setError(passwordErrorMessage(error));
    else {
      setSaved(true);
      setPassword("");
    }
  };

  return (
    <section id="securite" className="acc-card acc-form" aria-labelledby="h-securite">
      <h2 id="h-securite" className="acc-h3">{t("Mot de passe")}</h2>
      {error && <div className="error-box">{error}</div>}
      {saved && <div className="success-box">{t("Mot de passe mis à jour.")}</div>}
      <form onSubmit={handleSubmit} className="acc-form-body">
        <label className="acc-field">{t("Nouveau mot de passe")}
          <input
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <span className="acc-hint">{t(PASSWORD_HINT)}</span>
        <button className="v2-btn v2-btn-outline acc-btn" type="submit" disabled={saving}>
          {saving ? t("Enregistrement…") : t("Changer mon mot de passe")}
        </button>
      </form>
      <DangerZone />
    </section>
  );
}

export function FavoritesSection({ onChange }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    supabase
      .from("favorites")
      .select("id, race:races(id, name, country, km, month, start_date, discipline)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setFavorites(data);
      });
  };

  useEffect(() => { load(); }, []);

  const remove = async (favId) => {
    await supabase.from("favorites").delete().eq("id", favId);
    load();
    onChange?.();
  };

  return (
    <section id="favoris" className="acc-section" aria-labelledby="h-favoris">
      <div className="acc-section-head"><h2 id="h-favoris" className="acc-h2">{t("Favoris")}</h2></div>
      {error && <div className="error-box">{error}</div>}
      {favorites === null ? (
        <p className="muted">{t("Chargement…")}</p>
      ) : (
        <div className="acc-grid">
          {favorites.map((f) => (
            <article key={f.id} className="acc-card acc-fav">
              {f.race ? (
                <>
                  <DateTile race={f.race} />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <Link to={`/courses/${f.race.id}`} className="acc-fav-name">{f.race.name}</Link>
                    <span className="acc-result-sub">
                      {[t(f.race.country), t(f.race.discipline), f.race.km ? `${formatNumber(f.race.km)} km` : null].filter(Boolean).join(" · ")}
                    </span>
                    <Countdown race={f.race} />
                  </div>
                </>
              ) : (
                <span className="muted" style={{ flex: 1 }}>{t("Ultra supprimé")}</span>
              )}
              <button type="button" className="acc-heart" onClick={() => remove(f.id)} aria-label={t("Retirer {name} des favoris", { name: f.race?.name || t("cet ultra") })}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#B4541F" stroke="#B4541F" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
              </button>
            </article>
          ))}
          <Link to="/ultras" className="acc-add-tile">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            {favorites.length ? t("Trouver d'autres ultras") : t("Aucun favori pour l'instant : trouve un ultra et touche le cœur de sa fiche")}
          </Link>
        </div>
      )}
    </section>
  );
}

export function CommentsSection() {
  const { user } = useAuth();
  const [comments, setComments] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    supabase
      .from("comments")
      .select("id, body, status, deletion_requested, created_at, race:races(id, name)")
      .eq("author_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setComments(data);
      });
  };

  useEffect(() => { load(); }, []);

  const requestDeletion = async (id) => {
    if (!window.confirm(t("Demander à un administrateur de supprimer cet avis ?"))) return;
    await supabase.from("comments").update({ deletion_requested: true }).eq("id", id);
    load();
  };

  return (
    <section id="avis" className="acc-section" aria-labelledby="h-avis">
      <div className="acc-section-head"><h2 id="h-avis" className="acc-h2">{t("Mes avis")}</h2></div>
      {error && <div className="error-box">{error}</div>}
      {comments === null ? (
        <p className="muted">{t("Chargement…")}</p>
      ) : comments.length === 0 ? (
        <div className="acc-empty">
          <span>{t("Tu n'as pas encore laissé d'avis. Ton retour aide les autres participants à choisir leur ultra.")}</span>
          <Link to="/ultras" className="v2-link" style={{ fontSize: 14 }}>{t("Trouver un ultra →")}</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {comments.map((c) => (
            <article key={c.id} className="acc-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  {c.race ? <Link to={`/courses/${c.race.id}`} className="acc-fav-name">{c.race.name}</Link> : <span className="muted">{t("Ultra supprimé")}</span>}
                  {c.status === "pending" && <span className="acc-tag">{t("En attente de validation")}</span>}
                  {c.status === "hidden" && <span className="acc-tag">{t("Masqué par un admin")}</span>}
                </div>
                {c.deletion_requested ? (
                  <span className="acc-tag">{t("Suppression demandée")}</span>
                ) : (
                  <button type="button" className="acc-linkbtn acc-danger" onClick={() => requestDeletion(c.id)}>{t("Demander la suppression")}</button>
                )}
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--text3)" }}>{c.body}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function DangerZone() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    // Supprime données ET compte de connexion (fonction delete_my_account).
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setDeleting(false);
      setError(t("La suppression a échoué : {e}. Écris-nous à hello@ultraride.eu.", { e: error.message }));
      return;
    }
    await disablePush();
    // Le compte n'existe plus côté serveur : on efface la session locale.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    navigate("/", { replace: true });
  };

  return (
    <div id="compte" className="acc-danger-zone">
      <span className="acc-danger-title">{t("Supprimer mon compte")}</span>
      <p className="acc-hint" style={{ margin: 0 }}>
        {t("Ton compte est supprimé définitivement, avec ton profil, ton palmarès et tes favoris. Ton adresse email ne permet plus de te connecter. Tes avis restent visibles, signés « utilisateur supprimé ».")}
      </p>
      {error && <div className="error-box">{error}</div>}
      {!confirming ? (
        <button type="button" className="acc-btn acc-btn-danger" onClick={() => setConfirming(true)}>{t("Supprimer mon compte…")}</button>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="acc-hint">{t("Cette action est irréversible.")}</span>
          <button type="button" className="acc-btn acc-btn-danger-fill" onClick={handleDelete} disabled={deleting}>
            {deleting ? t("Suppression…") : t("Oui, supprimer définitivement")}
          </button>
          <button type="button" className="acc-linkbtn" onClick={() => setConfirming(false)}>{t("Annuler")}</button>
        </div>
      )}
    </div>
  );
}

export default function Account() {
  const { user, profile, loading, isOrganizer, isAdmin } = useAuth();
  const [summary, setSummary] = useState(null);
  const [counts, setCounts] = useState({ favorites: null, comments: null });

  // Cumuls du passeport et compteurs du menu, rechargés après chaque ajout
  // ou retrait dans le palmarès ou les favoris.
  const loadSummary = useCallback(() => {
    if (!user) return;
    supabase
      .from("race_results")
      .select("distance_km, elevation_gain, race:races(country)")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const list = data || [];
        setSummary({
          count: list.length,
          km: list.reduce((s, r) => s + (Number(r.distance_km) || 0), 0),
          dplus: list.reduce((s, r) => s + (Number(r.elevation_gain) || 0), 0),
          countries: new Set(list.map((r) => r.race?.country).filter(Boolean)).size,
        });
      });
    Promise.all([
      supabase.from("favorites").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("comments").select("id", { count: "exact", head: true }).eq("author_id", user.id),
    ]).then(([f, c]) => setCounts({ favorites: f.count ?? 0, comments: c.count ?? 0 }));
  }, [user?.id]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  if (loading) return <div className="wrap" style={{ paddingTop: 60 }}><p className="muted">{t("Chargement…")}</p></div>;
  if (!user) return <Navigate to="/login" replace />;

  const participantSections = !isOrganizer;
  const navItems = [
    ...(participantSections ? [
      { href: "#palmares", label: t("Palmarès"), count: summary?.count },
      { href: "#favoris", label: t("Favoris"), count: counts.favorites },
      { href: "#avis", label: t("Mes avis"), count: counts.comments },
    ] : []),
    { sep: true },
    { href: "#infos", label: t("Mes informations") },
    { href: "#securite", label: t("Mot de passe") },
    { href: "#compte", label: t("Supprimer mon compte"), danger: true },
  ];

  return (
    <div className="v2">
      <div className="v2-wrap acc-page">
        <PassportCard profile={profile} user={user} summary={summary} isOrganizer={isOrganizer} />

        <div className="acc-layout">
          <nav className="acc-nav" aria-label={t("Sections du compte")}>
            {navItems.map((it, i) =>
              it.sep ? (
                participantSections ? <span key={`s${i}`} className="acc-nav-sep" aria-hidden="true" /> : null
              ) : (
                <a key={it.href} href={it.href} className={`acc-nav-link${it.danger ? " acc-danger" : ""}`}>
                  {it.label}
                  {it.count != null && <span className="acc-nav-count">{it.count}</span>}
                </a>
              )
            )}
            {(isOrganizer || isAdmin) && (
              <>
                <span className="acc-nav-sep" aria-hidden="true" />
                <Link to="/organizer/races" className="acc-nav-link">{t("Mes ultras")}</Link>
                <Link to="/organizer/profile" className="acc-nav-link">{t("Fiche organisateur")}</Link>
                {isAdmin && <Link to="/admin" className="acc-nav-link">Admin</Link>}
              </>
            )}
          </nav>

          <main className="acc-main">
            {participantSections && <PalmaresSection onChange={loadSummary} />}
            {participantSections && <FavoritesSection onChange={loadSummary} />}
            {participantSections && <CommentsSection />}
            <div className="acc-two">
              <InfoSection />
              <PasswordSection />
            </div>
          </main>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
