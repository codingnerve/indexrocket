import { Router } from 'express';

import { login, logout, me, register } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

/** IndexRocket account authentication. Distinct from the Google OAuth routes. */
export const authRouter: Router = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/logout', logout);
authRouter.get('/me', requireAuth, me);
