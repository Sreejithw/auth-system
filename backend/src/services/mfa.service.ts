import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { generateSecret, generateURI, verify } from "otplib";
import { mfaEncryptionKey, env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_DRIFT_SECONDS = 30;
const RECOVERY_CODE_COUNT = 10;
const ENVELOPE_VERSION = "v1";

export interface MfaStatus {
  enabled: boolean;
}

interface MfaRow {
  secret_ciphertext: string;
  last_totp_counter: string | null;
}

interface RecoveryCodeRow {
  id: string;
  code_hash: string;
}

type Queryable = Pool | PoolClient;

/**
 * Encrypt a TOTP seed into a versioned AES-256-GCM envelope. The IV and
 * authentication tag are included with the ciphertext; the key remains only
 * in application configuration.
 */
export function encryptTotpSecret(
  secret: string,
  key: Buffer = mfaEncryptionKey,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Decrypt and authenticate a versioned TOTP envelope. */
export function decryptTotpSecret(
  envelope: string,
  key: Buffer = mfaEncryptionKey,
): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, ...extra] =
    envelope.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded ||
    extra.length > 0
  ) {
    throw new Error("Invalid MFA secret envelope");
  }

  try {
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    const ciphertext = Buffer.from(ciphertextEncoded, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("Invalid MFA secret envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error("Invalid MFA secret envelope");
  }
}

function recoveryCode(): string {
  // 160 random bits, URL-safe for convenient offline storage.
  return randomBytes(20).toString("base64url");
}

function assertTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

function verifiedCounter(
  result: Awaited<ReturnType<typeof verify>>,
): number | null {
  if (!result.valid) return null;
  // otplib reports the matched step as a delta from the current one. Persist
  // the actual counter so an otherwise-valid previous/current/future code
  // cannot be replayed in a concurrent or subsequent request.
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS) + result.delta;
}

export class MfaService {
  constructor(private readonly database: Pool = pool) {}

  async getStatus(userId: string): Promise<MfaStatus> {
    const { rowCount } = await this.database.query(
      "SELECT 1 FROM user_mfa WHERE user_id = $1",
      [userId],
    );
    return { enabled: rowCount === 1 };
  }

  /**
   * Creates a seed for a session-bound pending setup. The caller persists only
   * the returned encrypted envelope in its session; it is never written to the
   * MFA table until the user proves possession of it.
   */
  createSetup(): {
    encryptedSecret: string;
    secret: string;
    otpauthUrl: string;
  } {
    return this.createSetupForLabel(env.MFA_ISSUER);
  }

  createSetupForLabel(label: string): {
    encryptedSecret: string;
    secret: string;
    otpauthUrl: string;
  } {
    const secret = generateSecret();
    return {
      encryptedSecret: encryptTotpSecret(secret),
      secret,
      otpauthUrl: generateURI({
        issuer: env.MFA_ISSUER,
        label,
        secret,
        algorithm: "sha1",
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS,
      }),
    };
  }

  async activate(
    userId: string,
    encryptedPendingSecret: string,
    code: string,
  ): Promise<string[] | null> {
    if (!assertTotpCode(code)) return null;
    const secret = decryptTotpSecret(encryptedPendingSecret);
    const result = await verify({
      secret,
      token: code,
      period: TOTP_PERIOD_SECONDS,
      digits: TOTP_DIGITS,
      epochTolerance: TOTP_DRIFT_SECONDS,
    });
    const counter = verifiedCounter(result);
    if (counter === null) return null;

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    const hashes = await Promise.all(codes.map((value) => hashPassword(value)));
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO user_mfa (user_id, secret_ciphertext, last_totp_counter)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET secret_ciphertext = EXCLUDED.secret_ciphertext,
               last_totp_counter = EXCLUDED.last_totp_counter,
               enabled_at = now()`,
        [userId, encryptedPendingSecret, counter],
      );
      await client.query("DELETE FROM user_mfa_recovery_codes WHERE user_id = $1", [
        userId,
      ]);
      await this.insertRecoveryHashes(client, userId, hashes);
      await client.query("COMMIT");
      return codes;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Verifies a TOTP and records its time-step in the same row lock transaction,
   * preventing two concurrent requests from accepting the same OTP.
   */
  async verifyTotpAndConsume(userId: string, code: string): Promise<boolean> {
    if (!assertTotpCode(code)) return false;
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const row = await this.selectMfaForUpdate(client, userId);
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      const result = await verify({
        secret: decryptTotpSecret(row.secret_ciphertext),
        token: code,
        period: TOTP_PERIOD_SECONDS,
        digits: TOTP_DIGITS,
        epochTolerance: TOTP_DRIFT_SECONDS,
      });
      const counter = verifiedCounter(result);
      if (
        counter === null ||
        (row.last_totp_counter !== null &&
          counter <= Number(row.last_totp_counter))
      ) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "UPDATE user_mfa SET last_totp_counter = $2 WHERE user_id = $1",
        [userId, counter],
      );
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Locks the user's MFA row plus all currently usable recovery codes before
   * comparing Argon2id hashes and marking a matching code consumed.
   */
  async verifyRecoveryCodeAndConsume(
    userId: string,
    code: string,
  ): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(code)) return false;
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      if (!(await this.selectMfaForUpdate(client, userId))) {
        await client.query("ROLLBACK");
        return false;
      }
      const { rows } = await client.query<RecoveryCodeRow>(
        `SELECT id, code_hash FROM user_mfa_recovery_codes
         WHERE user_id = $1 AND consumed_at IS NULL
         FOR UPDATE`,
        [userId],
      );
      for (const row of rows) {
        if (await verifyPassword(row.code_hash, code)) {
          const updated = await client.query(
            `UPDATE user_mfa_recovery_codes
             SET consumed_at = now()
             WHERE id = $1 AND consumed_at IS NULL`,
            [row.id],
          );
          await client.query("COMMIT");
          return updated.rowCount === 1;
        }
      }
      await client.query("ROLLBACK");
      return false;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async verifyAnyMfaCredential(userId: string, code: string): Promise<boolean> {
    return (await this.verifyTotpAndConsume(userId, code)) ||
      this.verifyRecoveryCodeAndConsume(userId, code);
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    const hashes = await Promise.all(codes.map((value) => hashPassword(value)));
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      if (!(await this.selectMfaForUpdate(client, userId))) {
        await client.query("ROLLBACK");
        throw new Error("MFA is not enabled");
      }
      await client.query("DELETE FROM user_mfa_recovery_codes WHERE user_id = $1", [
        userId,
      ]);
      await this.insertRecoveryHashes(client, userId, hashes);
      await client.query("COMMIT");
      return codes;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async disable(userId: string): Promise<void> {
    await this.database.query("DELETE FROM user_mfa WHERE user_id = $1", [userId]);
  }

  private async selectMfaForUpdate(
    client: PoolClient,
    userId: string,
  ): Promise<MfaRow | null> {
    const { rows } = await client.query<MfaRow>(
      `SELECT secret_ciphertext, last_totp_counter
       FROM user_mfa WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    return rows[0] ?? null;
  }

  private async insertRecoveryHashes(
    client: Queryable,
    userId: string,
    hashes: string[],
  ): Promise<void> {
    for (const hash of hashes) {
      await client.query(
        "INSERT INTO user_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)",
        [userId, hash],
      );
    }
  }
}

export const mfaService = new MfaService();
