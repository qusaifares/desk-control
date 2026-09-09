import pino from 'pino';

export function createLogger(level: string) {
  const pretty = process.env.NODE_ENV !== 'production';
  return pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
