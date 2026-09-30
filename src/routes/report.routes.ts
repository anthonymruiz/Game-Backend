import { Router } from 'express';
import { container } from 'tsyringe';
import { ReportController } from '../controllers/report.controller.js';
import { requireAuth, requireRole } from '../middlewares/role.middleware.js';

export const reportRouter: Router = Router();
let _controller: ReportController;
const getController = () => {
  if (!_controller) _controller = container.resolve(ReportController);
  return _controller;
};

reportRouter.get('/', requireRole(['admin', 'superadmin']), (req, res) => getController().getReports(req, res));
reportRouter.get('/user/:userId', requireRole(['admin', 'superadmin']), (req, res) => getController().getReportsByUser(req, res));
reportRouter.post('/', requireAuth, (req, res) => getController().createReport(req, res));
reportRouter.put('/:id/status', requireRole(['admin', 'superadmin']), (req, res) => getController().updateReportStatus(req, res));

export default reportRouter;
