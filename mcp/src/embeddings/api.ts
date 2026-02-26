import type { EmbeddingProvider } from "./provider.js";

interface ApiEmbeddingConfig {
  url: string;
  model: string;
  apiKey: string;
  dimensions?: number;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export class ApiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "api";
  readonly dimensions: number;

  private readonly url: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(config: ApiEmbeddingConfig) {
    this.url = config.url;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.dimensions = config.dimensions ?? 384;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.model,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as EmbeddingResponse;
    return result.data[0].embedding.slice(0, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as EmbeddingResponse;
    return result.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding.slice(0, this.dimensions));
  }
}
