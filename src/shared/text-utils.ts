const EMBEDDING_DIM = 64;

const SPECIAL_TECH_TOKENS = new Set(['c++', 'c#', 'f#', 'g++', '.net', 'node.js', 'next.js', 'vue.js', 'react.js']);

export function tokenizeText(text: string): string[] {
  const lower = text.toLowerCase();
  const raw = lower
    .replace(/[^a-z0-9+#._/\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (const token of raw) {
    const cleaned = token.replace(/^[._/-]+|[._/-]+$/g, '');
    if (!cleaned) continue;
    if (SPECIAL_TECH_TOKENS.has(cleaned)) {
      out.push(cleaned);
      continue;
    }
    if (cleaned.length >= 2) {
      out.push(cleaned);
    }
    // Also emit sub-tokens split on punctuation (e.g. "http/3" -> "http", "foo_bar" -> "foo", "bar")
    if (/[._/-]/.test(cleaned)) {
      const parts = cleaned.split(/[._/-]+/).filter((p) => p.length >= 2);
      for (const p of parts) {
        if (p !== cleaned) out.push(p);
      }
    }
  }
  return out;
}

/**
 * Bounded Damerau-Levenshtein distance for fast typo correction on query tokens.
 */
export function editDistanceBounded(a: string, b: string, maxDist = 2): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (a === b) return 0;

  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array<number>(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[la][lb];
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
