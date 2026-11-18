import { t, isEn } from "./i18n";
// Barème d'affichage du prix. Les bornes hautes sont inclusives :
// 100 € donne un seul symbole, 100,01 € en donne deux.
export const PRICE_TIERS = [
  { max: 100, signs: 1, get label() { return t("Jusqu'à 100 €"); } },
  { max: 200, signs: 2, get label() { return t("De 100 à 200 €"); } },
  { max: 300, signs: 3, get label() { return t("De 200 à 300 €"); } },
  { max: Infinity, signs: 4, get label() { return t("Plus de 300 €"); } },
];

export function priceTier(price) {
  if (price === null || price === undefined || price === "") return null;
  const value = Number(price);
  if (Number.isNaN(value)) return null;
  return PRICE_TIERS.find((t) => value <= t.max) || null;
}

// Le prix exact n'est affiché que s'il est connu ; le barème, lui, reste
// lisible même sans montant précis.
export function formatPrice(price) {
  if (price === null || price === undefined || price === "") return null;
  const value = Number(price);
  if (Number.isNaN(value)) return null;
  if (isEn()) return value % 1 === 0 ? `€${value}` : `€${value.toFixed(2)}`;
  return value % 1 === 0
    ? `${value} €`
    : `${value.toFixed(2).replace(".", ",")} €`;
}
