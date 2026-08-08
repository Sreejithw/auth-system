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
    /** Stable server-generated identifier used for anonymous flag targeting. */
    flagAnonymousId?: string;
    /**
     * A short-lived, unauthenticated MFA login stage. This deliberately never
     * sets userId: only a successful second-factor check can authenticate it.
     */
    pendingMfaChallenge?: {
      userId: string;
      expiresAt: number;
    };
    /** Encrypted, short-lived seed awaiting TOTP activation. */
    pendingMfaSetup?: {
      encryptedSecret: string;
      expiresAt: number;
    };
    /** Timestamp of password + (where applicable) MFA authentication. */
    authenticatedAt?: number;
  }
}
