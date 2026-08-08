import { ClientTokenAuthentication } from "@flipt-io/flipt";
import { FliptProvider } from "@openfeature/flipt-provider";
import {
  OpenFeature,
  type EvaluationContext,
} from "@openfeature/server-sdk";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  CLIENT_FLAG_KEYS,
  FLAG_DEFINITIONS,
  type ClientFlags,
  type FlagKey,
} from "./definitions.js";

const EVALUATION_TIMEOUT_MS = 750;
const client = OpenFeature.getClient("auth-system");

type BooleanEvaluator = (
  key: FlagKey,
  defaultValue: boolean,
  context: EvaluationContext,
) => Promise<boolean>;

let initialization: Promise<void> | undefined;
let providerReady = false;

async function configureProvider(): Promise<void> {
  if (!env.FLIPT_ENABLED) {
    logger.info("Flipt feature flags disabled; using code defaults");
    return;
  }

  try {
    const provider = new FliptProvider(env.FLIPT_NAMESPACE, {
      url: env.FLIPT_URL,
      authenticationStrategy: env.FLIPT_TOKEN
        ? new ClientTokenAuthentication(env.FLIPT_TOKEN)
        : undefined,
    });
    await OpenFeature.setProviderAndWait(provider);
    providerReady = true;
    logger.info(
      { namespace: env.FLIPT_NAMESPACE },
      "Flipt feature flag provider initialized",
    );
  } catch {
    providerReady = false;
    logger.warn("Flipt provider initialization failed; using code defaults");
  }
}

/** Initializes the process-wide OpenFeature provider at most once. */
export function initializeFeatureFlags(): Promise<void> {
  initialization ??= configureProvider();
  return initialization;
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("feature flag evaluation timed out")),
          EVALUATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const evaluateWithProvider: BooleanEvaluator = async (
  key,
  defaultValue,
  context,
) => {
  if (!providerReady) return defaultValue;
  return withTimeout(client.getBooleanValue(key, defaultValue, context));
};

/**
 * Evaluates a known boolean flag and always falls back to its documented code
 * default. The optional evaluator is intentionally exposed for focused tests.
 */
export async function evaluateBooleanFlag(
  key: FlagKey,
  context: EvaluationContext,
  evaluator: BooleanEvaluator = evaluateWithProvider,
): Promise<boolean> {
  const defaultValue = FLAG_DEFINITIONS[key].defaultValue;
  try {
    return await evaluator(key, defaultValue, context);
  } catch {
    logger.warn({ flagKey: key }, "feature flag evaluation failed; using default");
    return defaultValue;
  }
}

/** Evaluates only the explicit browser-safe allowlist. */
export async function evaluateClientFlags(
  context: EvaluationContext,
  evaluator?: BooleanEvaluator,
): Promise<ClientFlags> {
  const entries = await Promise.all(
    CLIENT_FLAG_KEYS.map(async (key) => [
      key,
      await evaluateBooleanFlag(key, context, evaluator),
    ]),
  );
  return Object.fromEntries(entries) as ClientFlags;
}

/**
 * Clears registered providers during graceful process shutdown. The current
 * Flipt provider has no close hook, but this permits future providers to run
 * lifecycle cleanup through the OpenFeature SDK.
 */
export async function shutdownFeatureFlags(): Promise<void> {
  providerReady = false;
  await OpenFeature.clearProviders();
}

export type { EvaluationContext };
