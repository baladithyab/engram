import type { EmbeddingProvider } from "./provider.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DIMENSIONS = 384;
const CACHE_DIR = `${process.env.HOME}/.claude/engram/models`;

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;
  readonly name = "local";

  private pipeline: any = null;

  private async getPipeline(): Promise<any> {
    if (this.pipeline) return this.pipeline;

    const { pipeline, env } = await import("@xenova/transformers");
    env.cacheDir = CACHE_DIR;
    env.allowLocalModels = true;

    this.pipeline = await pipeline("feature-extraction", MODEL_ID);
    return this.pipeline;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.getPipeline();
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array).slice(0, DIMENSIONS);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      results.push(Array.from(output.data as Float32Array).slice(0, DIMENSIONS));
    }
    return results;
  }
}
