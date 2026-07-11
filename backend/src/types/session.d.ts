import "express-session";

declare module "express-session" {
  interface SessionData {
    /** Set on successful login; presence indicates an authenticated session. */
    userId?: string;
    /**
     * Marker written when a CSRF token is issued. Forces express-session to
     * persist the (otherwise uninitialized) session so its id — which the CSRF
     * token is bound to — stays stable through the subsequent mutating request.
     */
    csrfBootstrapped?: boolean;
  }
}
