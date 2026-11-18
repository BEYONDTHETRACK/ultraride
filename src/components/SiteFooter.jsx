import { Link } from "react-router-dom";
import { analyticsEnabled, openConsentBanner } from "../lib/analytics";
import { t, LangSwitch } from "../lib/i18n";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <span className="site-footer-logo">ULTRARIDE</span>
        <span className="site-footer-tagline">Ultra-cycling almanac</span>
      </div>
      <nav className="site-footer-links">
        <Link to="/cgu">{t("Mentions légales et CGU")}</Link>
        <span aria-hidden="true">·</span>
        <Link to="/confidentialite">{t("Politique de confidentialité")}</Link>
        <span aria-hidden="true">·</span>
        <a href="/app/">{t("L'app")}</a>
        <span aria-hidden="true">·</span>
        <a href="mailto:hello@ultraride.eu">Contact</a>
        {analyticsEnabled() && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" className="footer-link-button" onClick={openConsentBanner}>{t("Gérer les cookies")}</button>
          </>
        )}
      </nav>
      <div className="site-footer-legal">
        © 2026 UltraRide <LangSwitch style={{ marginLeft: 12, display: "inline-flex" }} />
      </div>
    </footer>
  );
}
