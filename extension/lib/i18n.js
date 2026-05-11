/* Minimal i18n for the extension UI.
 *
 * The web-app embed (iframe) has its own i18next pipeline and we
 * deliberately don't try to share state with it — extension storage
 * is separate from the app's localStorage. The user picks a language
 * for the extension chrome here; the iframe's content keeps following
 * whatever the user picked in the main app.
 *
 * Usage:
 *   import { t, applyTranslations, setLocale, getLocale } from "./lib/i18n.js";
 *   await applyTranslations();          // run once after DOM is built
 *   const msg = t("save.saving");       // dynamic string lookup
 *   await setLocale("de");              // user toggled the switcher
 *
 * Static strings live in the HTML as `data-i18n="key"` (textContent),
 * `data-i18n-title="key"` (title attribute), `data-i18n-aria="key"`
 * (aria-label), and `data-i18n-ph="key"` (placeholder). applyTranslations
 * walks the DOM each call and hydrates them — safe to call after every
 * locale switch.
 */

const STORAGE_KEY = "uiLocale";

const STRINGS = {
  en: {
    "header.settings": "Settings",
    "header.reload": "Re-detect this page",

    "loading.text": "Detecting page…",

    "save.notSavedYet": "Not saved yet",
    "save.button": "Save to Mindshift",
    "save.saving": "Saving…",
    "save.saved": "Saved.",
    "save.failed": "Failed: {error}",
    "save.lookupFailed": "Lookup failed: {error}",
    "save.untitled": "(untitled page)",

    "card.iframeTitle": "Card",

    "settings.language": "Language",
    "settings.languageDE": "Deutsch",
    "settings.languageEN": "English",

    "settings.connection": "Connection",
    "settings.apiUrl": "API URL",
    "settings.token": "Token",
    "settings.tokenPh": "Paste token from Settings → API & Extension",
    "settings.saveAndTest": "Save & test",
    "settings.howto": "Where do I get the token?",
    "settings.howto1": "Open Mindshift in your browser and sign in.",
    "settings.howto2": "Click the gear icon (lower-left) → <strong>API &amp; Extension</strong>.",
    "settings.howto3": "Click <strong>Reveal token</strong> and copy it here.",
    "settings.bothRequired": "Both fields are required.",
    "settings.testing": "Testing connection…",
    "settings.connected": "Connected.",
    "settings.couldNotReach": "Could not reach API: {error}",
    "settings.tokenExpired": "Token expired — paste a fresh one below.",
    "settings.tokenExpiresIn": "Token expires in {days} {days, plural, one {day} other {days}} — refresh it below.",
    "settings.tokenExpiredShort": "Token expired. Reconnect above.",

    "openTabs.title": "Open tabs",
    "openTabs.body": "Save every saveable tab in this window. Duplicates are skipped.",
    "openTabs.saveAll": "Save all tabs",
    "openTabs.saveAllN": "Save all tabs ({n})",
    "openTabs.stop": "Stop",
    "openTabs.noneSaveable": "No saveable tabs in this window.",
    "openTabs.couldNotRead": "Could not read tabs: {error}",
    "openTabs.progress": "Saved {saved}",
    "openTabs.progressFailed": ", failed {failed}",
    "openTabs.progressStopped": ", stopped ({stopped} skipped)",

    "toggles.readLater": "Save as Read Later (skip AI for now)",
    "toggles.readLaterBody":
      "Save to the library without spending AI tokens. Process selected cards later from the main app.",
    "toggles.autoSaveYT": "Auto-save fully-watched YouTube videos",
    "toggles.autoSaveYTBody":
      "When the video reaches the end, save it to Mindshift. Backend dedup makes replays safe.",
    "toggles.savingFailed": "Could not save toggle: {error}",

    "bookmarks.title": "Bookmarks",
    "bookmarks.body": "Import every link from your browser's bookmarks tree.",
    "bookmarks.import": "Import all bookmarks",
    "bookmarks.count": "{n} {n, plural, one {link} other {links}}",
    "bookmarks.reading": "Reading bookmarks…",
    "bookmarks.none": "No http(s) bookmarks found.",
    "bookmarks.queued": "Queued {n} {n, plural, one {bookmark} other {bookmarks}} for ingestion.",
  },
  de: {
    "header.settings": "Einstellungen",
    "header.reload": "Seite neu erkennen",

    "loading.text": "Seite wird erkannt…",

    "save.notSavedYet": "Noch nicht gespeichert",
    "save.button": "In Mindshift speichern",
    "save.saving": "Speichere…",
    "save.saved": "Gespeichert.",
    "save.failed": "Fehlgeschlagen: {error}",
    "save.lookupFailed": "Suche fehlgeschlagen: {error}",
    "save.untitled": "(unbenannte Seite)",

    "card.iframeTitle": "Card",

    "settings.language": "Sprache",
    "settings.languageDE": "Deutsch",
    "settings.languageEN": "English",

    "settings.connection": "Verbindung",
    "settings.apiUrl": "API-URL",
    "settings.token": "Token",
    "settings.tokenPh": "Token aus Settings → API & Extension einfügen",
    "settings.saveAndTest": "Speichern & testen",
    "settings.howto": "Woher bekomme ich den Token?",
    "settings.howto1": "Öffne Mindshift im Browser und melde dich an.",
    "settings.howto2":
      "Klick aufs Zahnrad (unten links) → <strong>API &amp; Extension</strong>.",
    "settings.howto3":
      "Klick auf <strong>Token anzeigen</strong> und kopier ihn hierher.",
    "settings.bothRequired": "Beide Felder sind erforderlich.",
    "settings.testing": "Verbindung wird getestet…",
    "settings.connected": "Verbunden.",
    "settings.couldNotReach": "API nicht erreichbar: {error}",
    "settings.tokenExpired": "Token abgelaufen — bitte unten einen neuen einfügen.",
    "settings.tokenExpiresIn":
      "Token läuft in {days} {days, plural, one {Tag} other {Tagen}} ab — unten bitte aktualisieren.",
    "settings.tokenExpiredShort": "Token abgelaufen. Oben neu verbinden.",

    "openTabs.title": "Offene Tabs",
    "openTabs.body":
      "Alle speicherbaren Tabs dieses Fensters sichern. Duplikate werden übersprungen.",
    "openTabs.saveAll": "Alle Tabs speichern",
    "openTabs.saveAllN": "Alle Tabs speichern ({n})",
    "openTabs.stop": "Stopp",
    "openTabs.noneSaveable": "Keine speicherbaren Tabs in diesem Fenster.",
    "openTabs.couldNotRead": "Tabs nicht lesbar: {error}",
    "openTabs.progress": "{saved} gespeichert",
    "openTabs.progressFailed": ", {failed} fehlgeschlagen",
    "openTabs.progressStopped": ", abgebrochen ({stopped} übersprungen)",

    "toggles.readLater": 'Als "Später lesen" speichern (KI vorerst überspringen)',
    "toggles.readLaterBody":
      "Speichert in die Bibliothek, ohne KI-Tokens auszugeben. Karten später aus der Haupt-App verarbeiten.",
    "toggles.autoSaveYT": "Vollständig gesehene YouTube-Videos automatisch speichern",
    "toggles.autoSaveYTBody":
      "Wenn das Video bis zum Ende läuft, wird es in Mindshift gespeichert. Backend-Dedup macht Wiederholungen sicher.",
    "toggles.savingFailed": "Schalter konnte nicht gespeichert werden: {error}",

    "bookmarks.title": "Lesezeichen",
    "bookmarks.body": "Alle Links aus dem Lesezeichen-Baum des Browsers importieren.",
    "bookmarks.import": "Alle Lesezeichen importieren",
    "bookmarks.count": "{n} {n, plural, one {Link} other {Links}}",
    "bookmarks.reading": "Lesezeichen werden gelesen…",
    "bookmarks.none": "Keine http(s)-Lesezeichen gefunden.",
    "bookmarks.queued":
      "{n} {n, plural, one {Lesezeichen} other {Lesezeichen}} zur Verarbeitung eingereiht.",
  },
};

let currentLocale = "en";

function detectInitialLocale() {
  // Browser hint — used only if no explicit preference is stored.
  const browser = (navigator.language || "en").toLowerCase();
  return browser.startsWith("de") ? "de" : "en";
}

export async function initLocale() {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    currentLocale = stored?.[STORAGE_KEY] || detectInitialLocale();
  } catch {
    currentLocale = detectInitialLocale();
  }
  return currentLocale;
}

export function getLocale() {
  return currentLocale;
}

export async function setLocale(locale) {
  if (locale !== "de" && locale !== "en") return;
  currentLocale = locale;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: locale });
  } catch {
    /* storage failed — UI still updates, just won't persist */
  }
  applyTranslations();
}

/** Tiny templating: `{name}` is replaced by vars.name. Plural form
 *  `{n, plural, one {one foo} other {N foos}}` picks `one` when n===1,
 *  `other` otherwise. Matches a subset of ICU MessageFormat — enough
 *  for the extension's simple plurals without pulling in a library. */
function format(template, vars = {}) {
  if (!template) return "";
  // First pass: handle plural blocks.
  let s = template.replace(
    /\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g,
    (_m, name, one, other) => {
      const n = Number(vars[name]);
      return Number.isFinite(n) && n === 1 ? one : other;
    },
  );
  // Second pass: simple variable interpolation.
  s = s.replace(/\{(\w+)\}/g, (_m, name) =>
    vars[name] === undefined || vars[name] === null ? "" : String(vars[name]),
  );
  return s;
}

export function t(key, vars) {
  const table = STRINGS[currentLocale] || STRINGS.en;
  const raw = table[key] ?? STRINGS.en[key] ?? key;
  return format(raw, vars);
}

/** Hydrate every `data-i18n*` element in the document. Idempotent —
 *  call after every locale switch and after dynamically inserting DOM. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    // Some strings contain HTML markup (`<strong>…</strong>`) for emphasis
    // — opt into innerHTML for those, plain textContent otherwise. We
    // never interpolate user input into translations, so this stays safe.
    const value = t(key);
    if (/[<>]/.test(value)) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  });
}
