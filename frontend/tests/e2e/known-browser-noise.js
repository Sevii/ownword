// Console messages caused by browser bugs rather than this app.
/** WebKit reports a CSP violation for its own built-in styling of <select> (reproduced
 *  with a bare <select> under style-src 'self'), not for anything this app loads. */
export const WEBKIT_SELECT_CSP = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/u;
