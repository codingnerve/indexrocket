import { Router } from 'express';

import {
  createProject,
  deleteProject,
  getProject,
  getProjectSummary,
  listProjects,
  updateProject,
} from '../controllers/project.controller.js';
import {
  cancelBatch,
  createBatch,
  getBatch,
  listBatchItems,
  listBatches,
} from '../controllers/batch.controller.js';
import {
  addProjectUrl,
  addProjectUrlsBulk,
  deleteProjectUrl,
  getProjectUrl,
  listProjectUrls,
} from '../controllers/projectUrl.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

/**
 * Project and project-scoped URL management.
 *
 * requireAuth is applied to the whole router, and every handler additionally
 * resolves the project through the session user, so neither a projectId nor a
 * urlId from the request grants access on its own.
 */
export const projectRouter: Router = Router();

projectRouter.use(requireAuth);

projectRouter.post('/', createProject);
projectRouter.get('/', listProjects);
projectRouter.get('/:id', getProject);
projectRouter.patch('/:id', updateProject);
projectRouter.delete('/:id', deleteProject);
projectRouter.get('/:id/summary', getProjectSummary);

projectRouter.post('/:projectId/urls', addProjectUrl);
projectRouter.post('/:projectId/urls/bulk', addProjectUrlsBulk);
projectRouter.get('/:projectId/urls', listProjectUrls);
projectRouter.get('/:projectId/urls/:urlId', getProjectUrl);
projectRouter.delete('/:projectId/urls/:urlId', deleteProjectUrl);

projectRouter.post('/:projectId/batches', createBatch);
projectRouter.get('/:projectId/batches', listBatches);
projectRouter.get('/:projectId/batches/:batchId', getBatch);
projectRouter.get('/:projectId/batches/:batchId/items', listBatchItems);
projectRouter.post('/:projectId/batches/:batchId/cancel', cancelBatch);
