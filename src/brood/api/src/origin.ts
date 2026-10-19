/**
 * The app's origin: where the API answers, and where every surface that links
 * into the app or posts to it builds its address from. A file of its own,
 * with no imports, so the pitch site's middleware and the checks can read it
 * without the rest of the API.
 */
export const APP_ORIGIN = "https://app.noisybrood.com";
