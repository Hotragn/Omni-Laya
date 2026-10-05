import { createFileRoute } from '@tanstack/react-router';
import { getEnv, getJudgeConfig } from '@/server/env.server';
import { json } from '@/server/http';
import { handleJudge } from '@/server/judge';

/** POST /api/judge: the reader's own yes/no question. See src/server/judge.ts. */
export const Route = createFileRoute('/api/judge')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let env: ReturnType<typeof getEnv>;
        try {
          env = getEnv();
        } catch (error) {
          return json(500, { error: error instanceof Error ? error.message : 'Missing configuration' });
        }
        return handleJudge(request, { judge: getJudgeConfig(env), cache: env.CACHE, limiter: env.SEARCH_RATE_LIMIT });
      },
    },
  },
});
