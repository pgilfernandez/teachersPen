import en from './locales/en.json';
import es from './locales/es.json';
import it from './locales/it.json';
import fr from './locales/fr.json';
import de from './locales/de.json';

export const languages = ['en', 'es', 'it', 'fr', 'de'] as const;
export type Language = typeof languages[number];
export const languageNames: Record<Language, string> = { en: 'English', es: 'Español', it: 'Italiano', fr: 'Français', de: 'Deutsch' };
const catalogs: Record<Language, Record<string, string>> = { en, es, it, fr, de };
export function isLanguage(value: unknown): value is Language { return languages.includes(value as Language); }
export function resolveSystemLanguage(preferred: readonly string[]): Language {
  for (const locale of preferred) {
    const language = locale.trim().toLowerCase().split(/[-_.@]/)[0];
    if (isLanguage(language)) return language;
  }
  return 'en';
}
export function translate(language: Language, source: string, values: Record<string, string | number> = {}): string {
  // Keep the underlying OS error intact while translating the app's diagnostic prefix.
  const releaseError = 'No se puede comprobar la liberación del atajo: ';
  if (source.startsWith(releaseError) && source !== `${releaseError}{error}`) return translate(language, 'No se puede comprobar la liberación del atajo: {error}', { error: source.slice(releaseError.length) });
  const template = catalogs[language]?.[source] ?? catalogs.en[source] ?? source;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]));
}
export function defaultTimerText(language: Language) { return translate(language, 'continuamos en'); }
export function isDefaultTimerText(text: string) { return languages.some(language => text === defaultTimerText(language)); }
