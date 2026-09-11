import { Router } from 'express';

import { getReady } from '../controllers/health.controller.js';
import { authRouter } from './auth.routes.js';
import { googleAuthRouter, googleRouter } from './google.routes.js';
import { healthRouter } from './health.routes.js';
import { projectRouter } from './project.routes.js';
import { urlRouter } from './url.routes.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.get('/ready', getReady);
apiRouter.use('/auth', authRouter);
apiRouter.use('/auth', googleAuthRouter);
apiRouter.use('/google', googleRouter);
apiRouter.use('/projects', projectRouter);
apiRouter.use('/urls', urlRouter);
