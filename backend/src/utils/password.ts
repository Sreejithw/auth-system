import argon2 from "argon2";

/**
 * Argon2id hashing options. Argon2id is the OWASP-recommended memory-hard KDF;
 * these parameters exceed the OWASP minimum (19 MiB, t=2, p=1).
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB (~19 MiB)
  timeCost: 3,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash or verification error — treat as a failed match.
    return false;
  }
}
