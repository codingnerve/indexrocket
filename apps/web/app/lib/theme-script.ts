/**
 * Runs before first paint (inlined in the root layout) so the page never
 * flashes the wrong theme. The preference lives in localStorage because it is
 * a purely visual, per-device setting; nothing related to authentication is
 * ever stored there.
 */
export const THEME_STORAGE_KEY = 'ir-theme';

export const themeInitScript = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
