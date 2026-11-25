import { createBackendContainer } from './container';

async function main(): Promise<void> {
  const { services, redis } = await createBackendContainer();
  services.logger.log('info', 'Atlas Background Worker started', {
    storageMode: services.repo.mode,
    pollIntervalMs: services.config.workerPollIntervalMs
  });
  services.worker.startLoop(services.config.workerPollIntervalMs);

  const shutdown = async () => {
    services.logger.log('info', 'Shutting down Atlas Background Worker');
    services.worker.stopLoop();
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    await services.repo.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((err) => {
  console.error('Fatal worker startup error:', err);
  process.exit(1);
});
