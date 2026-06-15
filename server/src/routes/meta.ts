import { Router, type Request, type Response } from 'express';
import { listConsultants } from '../data/consultants.js';

export const metaRouter = Router();

/** Consultant dropdown source (seeded, in-memory). */
metaRouter.get('/api/consultants', (_req: Request, res: Response) => {
  res.json({ status: 'ok', consultants: listConsultants() });
});
