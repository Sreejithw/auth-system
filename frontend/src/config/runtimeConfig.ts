export interface RuntimeConfig {
  apiUrl: string;
  version: string;
  gitSha: string;
  buildTime: string;
}

const LOCAL_API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

let runtimeConfig: RuntimeConfig | null = null;

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Runtime configuration must be a JSON object.');
  }

  const candidate = value as Partial<RuntimeConfig>;
  const apiUrl = candidate.apiUrl?.trim().replace(/\/+$/, '');

  if (!apiUrl) {
    throw new Error('Runtime configuration is missing apiUrl.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error('Runtime configuration contains an invalid apiUrl.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Runtime apiUrl must use HTTP or HTTPS.');
  }

  return {
    apiUrl,
    version: candidate.version?.trim() || 'development',
    gitSha: candidate.gitSha?.trim() || 'unknown',
    buildTime: candidate.buildTime?.trim() || 'unknown',
  };
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (import.meta.env.DEV) {
    runtimeConfig = parseRuntimeConfig({ apiUrl: LOCAL_API_URL });
    return runtimeConfig;
  }

  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Runtime configuration request failed (${response.status}).`);
  }
  runtimeConfig = parseRuntimeConfig(await response.json());

  return runtimeConfig;
}

export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    throw new Error('Runtime configuration has not been loaded.');
  }
  return runtimeConfig;
}
