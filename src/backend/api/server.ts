import http from 'node:http';
import type Redis from 'ioredis';
import type { ModelProvider } from '@main/agent/providers/model-provider';
import type { BackendConfig } from '../config';
import type { CloudRepository } from '../db/repository';
import type { SearchProvider } from '../modules/search/provider';
import { createBackendContainer } from '../container';
import { createCloudApiRouter, type BackendServicesContainer } from './router';

export { createBackendContainer };

export interface BackendRuntime {
  server: http.Server;
  port: number;
  services: BackendServicesContainer;
  redis: Redis | null;
  stop: () => Promise<void>;
}

export async function startCloudServer(opts?: {
  config?: BackendConfig;
  repo?: CloudRepository;
  searchProviders?: SearchProvider[];
  aiOverrideProvider?: ModelProvider;
  startInlineWorker?: boolean;
}): Promise<BackendRuntime> {
  const { services, redis } = await createBackendContainer(opts);
  const handler = createCloudApiRouter(services);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(services.config.port, services.config.host, () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : services.config.port;

  if (opts?.startInlineWorker) {
    services.worker.startLoop(services.config.workerPollIntervalMs);
  }

  services.logger.log('info', 'LAVRAY Cloud Backend listening', {
    host: services.config.host,
    port,
    storageMode: services.repo.mode
  });

  return {
    server,
    port,
    services,
    redis,
    stop: async () => {
      services.worker.stopLoop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (redis) {
        try {
          await redis.quit();
        } catch {
          redis.disconnect();
        }
      }
      await services.repo.close();
    }
  };
}

if (require.main === module) {
  const inlineWorker = process.env.LAVRAY_INLINE_WORKER !== 'false';
  void startCloudServer({ startInlineWorker: inlineWorker }).then((runtime) => {
    const shutdown = async () => {
      await runtime.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}
