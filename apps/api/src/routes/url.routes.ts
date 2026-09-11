import { Router } from 'express';

import { discoverUrl, getUrl, inspectUrl } from '../controllers/url.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

/** Every URL route is authenticated and ownership-checked in the controller. */
export const urlRouter: Router = Router();

urlRouter.post('/inspect', requireAuth, inspectUrl);
urlRouter.post('/:id/discover', requireAuth, discoverUrl);
urlRouter.get('/:id', requireAuth, getUrl);
