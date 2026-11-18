import { useEffect, useState } from "react";
import "@fontsource/oswald/700.css";
import { isNative } from "../lib/native";

// Écran de démarrage animé de l'app (maquette « Le pouls UltraRide ») :
// le logo bat comme un cœur à 60 BPM pendant 3 s, avec « Powered by Beyond
// The Track » en bas, puis fondu vers l'accueil.
// Il prend le relais de l'écran natif fixe (même fond, même logo, même taille).
const DURATION = 3000;

let nativeHidden = false;
function hideNativeSplash() {
  if (nativeHidden) return;
  nativeHidden = true;
  import("@capacitor/splash-screen")
    .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 0 }))
    .catch(() => {});
}
const FADE = 300;

export default function AppSplash() {
  const [phase, setPhase] = useState(isNative ? "show" : "done");
  const [loaded, setLoaded] = useState(0);

  // L'écran natif fixe n'est retiré qu'une fois les deux logos dessinés :
  // sinon on voit un instant le fond parchemin vide (le « flash »).
  useEffect(() => {
    if (!isNative || loaded < 2) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => hideNativeSplash());
    });
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  useEffect(() => {
    if (!isNative) return;
    // Filet de sécurité : si une image ne se charge pas, on ne reste pas bloqué.
    const t0 = setTimeout(hideNativeSplash, 1500);
    const t1 = setTimeout(() => setPhase("fade"), DURATION);
    const t2 = setTimeout(() => setPhase("done"), DURATION + FADE);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  function onImg() { setLoaded((n) => n + 1); }

  if (phase === "done") return null;
  return (
    <div className={`app-splash${phase === "fade" ? " app-splash--out" : ""}`} aria-hidden="true">
      <img className="app-splash-logo" src="/logo.png" alt="" onLoad={onImg} onError={onImg} />
      <div className="app-splash-credit">
        <div className="app-splash-by">
          <span className="app-splash-txt">POWERED BY</span>
          <img className="app-splash-btt" src="/btt-logo.png" alt="" onLoad={onImg} onError={onImg} />
        </div>
      </div>
    </div>
  );
}
