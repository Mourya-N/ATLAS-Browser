const EMBEDDING_DIM = 64;

export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Deterministic signed feature-hashing word + character trigram embedding (L2-normalized).
 * Uses signed projections so unrelated texts sit near 0 similarity rather than colliding in +orthant.
 */
export function computeLocalEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return vec;

  const words = tokenizeText(normalized);
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBEDDING_DIM;
    const wSign = ((h >>> 16) & 1) === 0 ? 1 : -1;
    vec[idx] += wSign * 1.5;

    for (let i = 0; i <= w.length - 3; i++) {
      const tri = w.slice(i, i + 3);
      let th = 2166136261;
      for (let j = 0; j < 3; j++) {
        th ^= tri.charCodeAt(j);
        th = Math.imul(th, 16777619);
      }
      const tSign = ((th >>> 16) & 1) === 0 ? 1 : -1;
      vec[Math.abs(th) % EMBEDDING_DIM] += tSign * 0.6;
    }
  }

  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] = Number((vec[i] / norm).toFixed(5));
    }
  }
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return Math.max(0, Math.min(1, dot));
}
