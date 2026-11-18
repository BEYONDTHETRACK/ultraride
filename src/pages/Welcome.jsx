import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ROLES, CheckIcon } from "./Login";
import { t } from "../lib/i18n";

// Premier passage d'un compte créé via Google / Apple : il n'a encore choisi
// ni son rôle ni accepté les CGU. Une seule fois (RPC complete_oauth_onboarding).
export default function Welcome() {
  const { user, needsOnboarding, completeOnboarding, loading } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState("participant");
  const [terms, setTerms] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!needsOnboarding) return <Navigate to="/account" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!terms) {
      setError(t("Merci d'accepter les CGU, la politique de confidentialité et les règles pour continuer."));
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await completeOnboarding({ role, terms, marketing: newsletter });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate(role === "organizer" ? "/organizer/profile" : "/account", { replace: true });
  };

  return (
    <main className="v2-wrap auth-page">
      <div className="auth-shell auth-shell-single">
        <section className="auth-main">
          <div className="auth-forgot-head">
            <h2 className="auth-h2">{t("Bienvenue sur UltraRide")}</h2>
            <p>{t("Connecté avec")} <strong>{user.email}</strong>. {t("Dernière étape : tu viens sur UltraRide en tant que…")}</p>
          </div>
          {error && <div className="error-box" role="alert">{error}</div>}
          <form onSubmit={submit} className="auth-form">
            <div className="auth-roles" role="radiogroup" aria-label={t("Type de compte")}>
              {ROLES.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={role === r.id} className="auth-role" onClick={() => setRole(r.id)}>
                  <span className="auth-role-top">
                    <span className="auth-role-icon" aria-hidden="true">{r.icon}</span>
                    <span className="auth-radio" aria-hidden="true" />
                  </span>
                  <span className="auth-role-title">{t(r.title)}</span>
                  <span className="auth-role-text">{t(r.text)}</span>
                </button>
              ))}
            </div>
            <label className="auth-check">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span className="auth-box" aria-hidden="true"><CheckIcon /></span>
              <span>
                {t("J'accepte les")} <Link to="/cgu" target="_blank" rel="noopener noreferrer">{t("CGU")}</Link>, {t("la")}{" "}
                <Link to="/confidentialite" target="_blank" rel="noopener noreferrer">{t("politique de confidentialité")}</Link> {t("et les")}{" "}
                <Link to="/rules" target="_blank" rel="noopener noreferrer">{t("règles de bonne conduite")}</Link>.
                <span className="auth-req"> *</span>
              </span>
            </label>
            <label className="auth-check">
              <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
              <span className="auth-box" aria-hidden="true"><CheckIcon /></span>
              <span>{t("Recevoir les nouveaux ultras et les actualités par email")} <span className="auth-muted">{t("(facultatif)")}</span></span>
            </label>
            <button className="v2-btn v2-btn-rust auth-submit" type="submit" disabled={saving}>
              {saving ? "…" : t("C'est parti")}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
