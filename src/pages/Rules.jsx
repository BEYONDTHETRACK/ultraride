import { isEn } from "../lib/i18n";

export default function Rules() {
  if (isEn()) return <RulesEn />;
  return (
    <div className="wrap" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 640 }}>
      <h1 className="h1">Règles de la communauté</h1>
      <div className="prose" style={{ color: "var(--paperDim)", lineHeight: 1.7, fontSize: 14 }}>
        <p>UltraRide est un répertoire construit par et pour la communauté de l'ultra-distance à vélo. Pour que les avis et échanges restent utiles à tous, merci de respecter ces quelques règles simples :</p>
        <ul>
          <li>Reste factuel et respectueux dans tes avis, même en cas de désaccord avec un organisateur ou un autre participant.</li>
          <li>Pas de propos injurieux, discriminatoires, diffamatoires ou harcelants.</li>
          <li>Pas de spam, de publicité non sollicitée ni de contenu hors sujet.</li>
          <li>Ne publie pas d'informations personnelles concernant un tiers sans son accord.</li>
          <li>Un avis doit refléter une expérience réelle et sincère.</li>
        </ul>
        <p>Un commentaire qui enfreint ces règles peut être masqué ou supprimé par un administrateur. En cas de manquement répété, un compte peut voir ses droits de publication restreints.</p>
        <p className="muted" style={{ fontSize: 12 }}>
          Cette charte est une base de bon sens pour l'usage du site et n'a pas vocation à constituer un texte juridique complet (CGU).
        </p>
      </div>
    </div>
  );
}

function RulesEn() {
  return (
    <div className="wrap" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 640 }}>
      <h1 className="h1">Community rules</h1>
      <div className="prose" style={{ color: "var(--paperDim)", lineHeight: 1.7, fontSize: 14 }}>
        <p>UltraRide is a directory built by and for the ultra-distance cycling community. To keep reviews and discussions useful for everyone, please follow these few simple rules:</p>
        <ul>
          <li>Stay factual and respectful in your reviews, even if you disagree with an organiser or another participant.</li>
          <li>No insulting, discriminatory, defamatory or harassing content.</li>
          <li>No spam, unsolicited advertising or off-topic content.</li>
          <li>Don't publish personal information about someone else without their consent.</li>
          <li>A review must reflect a real and sincere experience.</li>
        </ul>
        <p>A comment that breaks these rules may be hidden or deleted by an administrator. In case of repeated breaches, an account's posting rights may be restricted.</p>
        <p className="muted" style={{ fontSize: 12 }}>
          This charter is a common-sense basis for using the site and is not intended to be a complete legal text (see the terms, available in French).
        </p>
      </div>
    </div>
  );
}
