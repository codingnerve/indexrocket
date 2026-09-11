import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { corsOptions } from './config/cors.js';
import { env } from './config/env.js';
import { sanitizeUrlForLog } from './config/logging.js';
import { csrfGuard } from './middleware/csrfGuard.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { requestId } from './middleware/requestId.js';
import { apiRouter } from './routes/index.js';

const JSON_BODY_LIMIT = '1mb';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);

  app.use(requestId);

  // Registered before anything that can reject a request, so rejections
  // (CORS, CSRF, malformed bodies) are logged too. The URL is always the
  // redacted one; referrer, cookies and headers are never logged.
  morgan.token('safe-url', (req) => sanitizeUrlForLog((req as Request).originalUrl));
  morgan.token('req-id', (req) => (req as Request).requestId ?? '-');
  app.use(
    morgan(
      env.isProduction
        ? ':remote-addr [:date[iso]] :req-id ":method :safe-url" :status :res[content-length] :response-time ms ":user-agent"'
        : ':method :safe-url :status :response-time ms - :res[content-length] :req-id',
    ),
  );

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(csrfGuard);
  // Session identity travels in an HttpOnly cookie holding an opaque id that is
  // validated against Redis, so nothing needs to be signed here.
  app.use(cookieParser());
  // JSON is the only body format accepted. There is deliberately no urlencoded
  // parser: HTML forms are the classic CSRF carrier and no route needs them.
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
