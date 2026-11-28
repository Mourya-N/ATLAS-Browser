import type { SearchResponse } from '@shared/types';

export type InstantAnswerPayload = NonNullable<SearchResponse['instantAnswer']>;

/**
 * Safe recursive-descent arithmetic evaluator (no eval / Function).
 * Supports +, -, *, /, %, ^, parentheses, sqrt(), abs(), round(), pi, e.
 */
function evaluateMathExpression(raw: string): number | null {
  const expr = raw
    .trim()
    .replace(/^=\s*/, '')
    .replace(/\bpi\b/gi, String(Math.PI))
    .replace(/\be\b/gi, String(Math.E))
    .replace(/×/g, '*')
    .replace(/÷/g, '/');

  if (!expr || !/[0-9]/.test(expr)) return null;
  // Require at least one operator or math function so plain numbers don't trigger calculator
  if (!/[+\-*/%^()]|\b(?:sqrt|abs|round|sin|cos|log)\b/i.test(expr)) return null;
  if (/[^0-9+\-*/%^().,\s_a-z]/i.test(expr)) return null;

  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ('+-*/%^(),'.includes(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[0-9._]/.test(expr[i])) {
        if (expr[i] !== '_') num += expr[i];
        i += 1;
      }
      if (!/^\d*(?:\.\d+)?$/.test(num) || num === '' || num === '.') return null;
      tokens.push(num);
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      let fn = '';
      while (i < expr.length && /[a-z]/i.test(expr[i])) {
        fn += expr[i].toLowerCase();
        i += 1;
      }
      if (!['sqrt', 'abs', 'round', 'floor', 'ceil', 'sin', 'cos', 'log'].includes(fn)) return null;
      tokens.push(fn);
      continue;
    }
    return null;
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseExpr = (): number => {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else {
        left %= right;
      }
    }
    return left;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    if (peek() === '^') {
      consume();
      return Math.pow(base, parsePower());
    }
    return base;
  };

  const parseUnary = (): number => {
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end');
    if (tok === '(') {
      consume();
      const val = parseExpr();
      if (consume() !== ')') throw new Error('Unmatched (');
      return val;
    }
    if (/^[a-z]+$/.test(tok)) {
      const fn = consume();
      if (consume() !== '(') throw new Error('Expected (');
      const arg = parseExpr();
      if (consume() !== ')') throw new Error('Expected )');
      switch (fn) {
        case 'sqrt': return Math.sqrt(arg);
        case 'abs': return Math.abs(arg);
        case 'round': return Math.round(arg);
        case 'floor': return Math.floor(arg);
        case 'ceil': return Math.ceil(arg);
        case 'sin': return Math.sin(arg);
        case 'cos': return Math.cos(arg);
        case 'log': return Math.log10(arg);
        default: throw new Error('Unsupported fn');
      }
    }
    consume();
    const num = Number(tok);
    if (!Number.isFinite(num)) throw new Error('Invalid number');
    return num;
  };

  try {
    const val = parseExpr();
    if (pos !== tokens.length || !Number.isFinite(val)) return null;
    return Number(val.toPrecision(12));
  } catch {
    return null;
  }
}

const LENGTH_TO_M: Record<string, number> = {
  mm: 0.001, millimeter: 0.001, millimeters: 0.001,
  cm: 0.01, centimeter: 0.01, centimeters: 0.01,
  m: 1, meter: 1, meters: 1,
  km: 1000, kilometer: 1000, kilometers: 1000,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  yd: 0.9144, yard: 0.9144, yards: 0.9144,
  mi: 1609.344, mile: 1609.344, miles: 1609.344
};

const MASS_TO_G: Record<string, number> = {
  mg: 0.001, g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125,
  lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237
};

const DATA_TO_BYTES: Record<string, number> = {
  b: 1, byte: 1, bytes: 1,
  kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4
};

function tryUnitConversion(raw: string): InstantAnswerPayload | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z°]+)\s+(?:to|in|into)\s+([a-z°]+)\s*$/i.exec(raw);
  if (!m) return null;
  const val = Number(m[1]);
  const from = m[2].toLowerCase().replace(/^°/, '');
  const to = m[3].toLowerCase().replace(/^°/, '');
  if (!Number.isFinite(val)) return null;

  // Temperature
  const tempAliases: Record<string, 'c' | 'f' | 'k'> = {
    c: 'c', celsius: 'c', centigrade: 'c',
    f: 'f', fahrenheit: 'f',
    k: 'k', kelvin: 'k'
  };
  if (tempAliases[from] && tempAliases[to]) {
    const f = tempAliases[from];
    const t = tempAliases[to];
    let celsius = val;
    if (f === 'f') celsius = (val - 32) * (5 / 9);
    else if (f === 'k') celsius = val - 273.15;
    let out = celsius;
    if (t === 'f') out = celsius * (9 / 5) + 32;
    else if (t === 'k') out = celsius + 273.15;
    const rounded = Number(out.toFixed(4));
    return {
      kind: 'conversion',
      title: `${val} ${m[2]} = ${rounded} ${m[3]}`,
      subtitle: 'Unit Converter • Temperature',
      summary: `${val} ${m[2]} equals ${rounded} ${m[3]}.`,
      url: `lavray://search?q=${encodeURIComponent(raw)}`,
      source: 'LAVRAY Instant Converter',
      facts: [
        { label: 'Input', value: `${val} ${m[2]}` },
        { label: 'Result', value: `${rounded} ${m[3]}` }
      ]
    };
  }

  const convertTable = (table: Record<string, number>, category: string): InstantAnswerPayload | null => {
    if (table[from] && table[to]) {
      const out = Number(((val * table[from]) / table[to]).toPrecision(8));
      return {
        kind: 'conversion',
        title: `${val} ${m[2]} = ${out} ${m[3]}`,
        subtitle: `Unit Converter • ${category}`,
        summary: `${val} ${m[2]} equals ${out} ${m[3]}.`,
        url: `lavray://search?q=${encodeURIComponent(raw)}`,
        source: 'LAVRAY Instant Converter',
        facts: [
          { label: 'Input', value: `${val} ${m[2]}` },
          { label: 'Result', value: `${out} ${m[3]}` }
        ]
      };
    }
    return null;
  };

  return (
    convertTable(LENGTH_TO_M, 'Length') ||
    convertTable(MASS_TO_G, 'Mass') ||
    convertTable(DATA_TO_BYTES, 'Digital Storage')
  );
}

function tryColorInspector(raw: string): InstantAnswerPayload | null {
  const m = /^\s*(?:color\s+)?#([0-9a-f]{6}|[0-9a-f]{3})\s*$/i.exec(raw);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return {
    kind: 'color',
    title: `#${hex.toUpperCase()}`,
    subtitle: 'Color Picker',
    summary: `RGB(${r}, ${g}, ${b})`,
    url: `lavray://search?q=${encodeURIComponent(raw)}`,
    source: 'LAVRAY Color Inspector',
    facts: [
      { label: 'HEX', value: `#${hex.toUpperCase()}` },
      { label: 'RGB', value: `rgb(${r}, ${g}, ${b})` }
    ]
  };
}

function tryTimestampTool(raw: string): InstantAnswerPayload | null {
  if (/^\s*(?:unix\s+timestamp|current\s+(?:unix\s+)?(?:timestamp|epoch)|epoch\s+now)\s*$/i.test(raw)) {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      kind: 'conversion',
      title: String(nowSec),
      subtitle: 'Unix Epoch Timestamp (seconds)',
      summary: `${new Date(nowSec * 1000).toUTCString()}`,
      url: `lavray://search?q=${encodeURIComponent(raw)}`,
      source: 'LAVRAY Instant Converter',
      facts: [
        { label: 'UTC', value: new Date(nowSec * 1000).toISOString() },
        { label: 'Milliseconds', value: String(nowSec * 1000) }
      ]
    };
  }
  const m = /^\s*(?:unix\s+timestamp|timestamp|epoch)?\s*(\d{10}|\d{13})\s*(?:to\s+(?:date|utc|iso))?\s*$/i.exec(raw);
  if (!m) return null;
  const num = Number(m[1]);
  const ms = m[1].length === 13 ? num : num * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return {
    kind: 'conversion',
    title: d.toUTCString(),
    subtitle: 'Unix Timestamp Converter',
    summary: `ISO 8601: ${d.toISOString()}`,
    url: `lavray://search?q=${encodeURIComponent(raw)}`,
    source: 'LAVRAY Instant Converter',
    facts: [
      { label: 'ISO', value: d.toISOString() },
      { label: 'Local', value: d.toLocaleString() }
    ]
  };
}

function tryNumberBaseTool(raw: string): InstantAnswerPayload | null {
  const m = /^\s*(?:(0x[0-9a-f]+|0b[01]+|\d+))\s+(?:to|in|into)\s+(hex|hexadecimal|bin|binary|dec|decimal|oct|octal)\s*$/i.exec(
    raw
  );
  if (!m) return null;
  const input = m[1].toLowerCase();
  const target = m[2].toLowerCase();
  const value = input.startsWith('0x')
    ? parseInt(input.slice(2), 16)
    : input.startsWith('0b')
    ? parseInt(input.slice(2), 2)
    : parseInt(input, 10);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  let formatted = '';
  let label = '';
  if (target.startsWith('hex')) {
    formatted = `0x${value.toString(16).toUpperCase()}`;
    label = 'Hexadecimal';
  } else if (target.startsWith('bin')) {
    formatted = `0b${value.toString(2)}`;
    label = 'Binary';
  } else if (target.startsWith('oct')) {
    formatted = `0o${value.toString(8)}`;
    label = 'Octal';
  } else {
    formatted = String(value);
    label = 'Decimal';
  }
  return {
    kind: 'conversion',
    title: formatted,
    subtitle: `Base Converter • ${label}`,
    summary: `${m[1]} = ${formatted}`,
    url: `lavray://search?q=${encodeURIComponent(raw)}`,
    source: 'LAVRAY Base Converter',
    facts: [
      { label: 'Decimal', value: String(value) },
      { label: 'Hex', value: `0x${value.toString(16).toUpperCase()}` },
      { label: 'Binary', value: `0b${value.toString(2)}` }
    ]
  };
}

/**
 * Evaluates zero-latency instant search tools (Calculator, Unit Converter, Color, Percentage, Timestamp, Base).
 * Executes strictly locally in <1ms without network calls or eval().
 */
export function evaluateInstantTool(query: string): InstantAnswerPayload | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Percentage discount / markup: "15% off 2000" or "2000 - 15%"
  const offMatch = /^\s*(\d+(?:\.\d+)?)\s*%\s+off\s+(\d+(?:\.\d+)?)\s*$/i.exec(trimmed);
  if (offMatch) {
    const pct = Number(offMatch[1]);
    const base = Number(offMatch[2]);
    const savings = Number(((pct / 100) * base).toPrecision(12));
    const finalPrice = Number((base - savings).toPrecision(12));
    return {
      kind: 'calculator',
      title: `${finalPrice}`,
      subtitle: 'Calculator • Discount',
      summary: `${pct}% off ${base} saves ${savings} → ${finalPrice}`,
      url: `lavray://search?q=${encodeURIComponent(trimmed)}`,
      source: 'LAVRAY Calculator',
      facts: [
        { label: 'Saved', value: String(savings) },
        { label: 'Original', value: String(base) }
      ]
    };
  }

  // Percentage shorthand: "15% of 240"
  const pctMatch = /^\s*(-?\d+(?:\.\d+)?)\s*%\s+of\s+(-?\d+(?:\.\d+)?)\s*$/i.exec(trimmed);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    const base = Number(pctMatch[2]);
    const res = Number(((pct / 100) * base).toPrecision(12));
    return {
      kind: 'calculator',
      title: `${res}`,
      subtitle: 'Calculator',
      summary: `${pct}% of ${base} = ${res}`,
      url: `lavray://search?q=${encodeURIComponent(trimmed)}`,
      source: 'LAVRAY Calculator',
      facts: [{ label: 'Expression', value: `${pct}% of ${base}` }]
    };
  }

  const ts = tryTimestampTool(trimmed);
  if (ts) return ts;

  const baseConv = tryNumberBaseTool(trimmed);
  if (baseConv) return baseConv;

  const unit = tryUnitConversion(trimmed);
  if (unit) return unit;

  const color = tryColorInspector(trimmed);
  if (color) return color;

  const mathVal = evaluateMathExpression(trimmed);
  if (mathVal !== null) {
    return {
      kind: 'calculator',
      title: `${mathVal}`,
      subtitle: 'Calculator',
      summary: `${trimmed} = ${mathVal}`,
      url: `lavray://search?q=${encodeURIComponent(trimmed)}`,
      source: 'LAVRAY Calculator',
      facts: [{ label: 'Expression', value: trimmed }]
    };
  }

  return null;
}
