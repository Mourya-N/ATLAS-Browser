import { redactSecrets, redactObjectSecrets } from '@shared/redaction';

export interface StructuredLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  requestId?: string;
  message: string;
  meta?: Record<string, unknown>;
}

export class BackendLogger {
  constructor(
    private readonly serviceName: string,
    private readonly sink: (line: string) => void = (line) => {
      if (process.env.NODE_ENV !== 'test') {
        process.stdout.write(`${line}\n`);
      }
    }
  ) {}

  public log(
    level: 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
    requestId?: string
  ): StructuredLogEntry {
    const sanitizedMeta = meta ? redactObjectSecrets(meta) : undefined;
    // Strip raw page content if accidentally passed unless explicitly permitted
    if (sanitizedMeta && 'pageContent' in sanitizedMeta) {
      sanitizedMeta.pageContent = '[REDACTED_PAGE_CONTENT]';
    }
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      requestId,
      message: redactSecrets(message),
      meta: sanitizedMeta
    };
    this.sink(JSON.stringify(entry));
    return entry;
  }
}
