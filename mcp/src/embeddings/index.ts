import type { EmbeddingProvider } from "./provider.js";
import { LocalEmbeddingProvider } from "./local.js";
import { ApiEmbeddingProvider } from "./api.js";

export type { EmbeddingProvider } from "./provider.js";

export interface EmbeddingConfig {
  provider?: string;
  url?: string;
  model?: string;
  apiKey?: string;
  dimensions?: number;
}

export function createEmbeddingProvider(config?: EmbeddingConfig): EmbeddingProvider {
  if (config?.provider === "api") {
    if (!config.url || !config.apiKey) {
      throw new Error(
        "API embedding provider requires 'url' and 'apiKey' in config"
      );
    }
    return new ApiEmbeddingProvider({
      url: config.url,
      model: config.model ?? "text-embedding-3-small",
      apiKey: config.apiKey,
      dimensions: config.dimensions,
    });
  }

  return new LocalEmbeddingProvider();
}
