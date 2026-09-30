import { Router } from 'express';
import { container } from 'tsyringe';
import { ReportController } from '../controllers/report.controller.js';
import { requireAuth, requireRole } from '../middlewares/role.middleware.js';

export const reportRouter: Router = Router();
const reportController = container.resolve(ReportController);

reportRouter.post('/', requireAuth, reportController.createReport);
reportRouter.put('/:id/status', requireRole(['admin', 'superadmin']), reportController.updateReportStatus);

export default reportRouter;
