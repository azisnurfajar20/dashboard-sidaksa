import type { IncomingMessage, ServerResponse } from 'node:http';
import { vercelData } from '../server/vercel-data.js';

export default function cron(req: IncomingMessage, res: ServerResponse) {
  req.url = '/api/sidaksa-cron';
  return vercelData(req, res);
}