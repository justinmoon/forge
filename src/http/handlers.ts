import { htmlResponse, jsonResponse } from './router';
import type { ForgeConfig } from '../types';

export function createHandlers(config: ForgeConfig) {
  return {
    getRoot: async (req: Request, params: Record<string, string>) => {
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>forge</title></head>
          <body>
            <h1>forge v0.1.0</h1>
            <p>Placeholder: Repository list</p>
          </body>
        </html>
      `);
    },

    getRepo: async (req: Request, params: Record<string, string>) => {
      const { repo } = params;
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>${repo} - forge</title></head>
          <body>
            <h1>${repo}</h1>
            <p>Placeholder: Merge request list</p>
          </body>
        </html>
      `);
    },

    getMergeRequest: async (req: Request, params: Record<string, string>) => {
      const { repo, branch } = params;
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>${repo} / ${branch} - forge</title></head>
          <body>
            <h1>${repo} / ${branch}</h1>
            <p>Placeholder: MR detail, diff, CI status, merge button</p>
          </body>
        </html>
      `);
    },

    getHistory: async (req: Request, params: Record<string, string>) => {
      const { repo } = params;
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>${repo} history - forge</title></head>
          <body>
            <h1>${repo} history</h1>
            <p>Placeholder: Merged requests history</p>
          </body>
        </html>
      `);
    },

    getJobs: async (req: Request, params: Record<string, string>) => {
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>CI Jobs - forge</title></head>
          <body>
            <h1>CI Jobs</h1>
            <p>Placeholder: Running and historical jobs</p>
          </body>
        </html>
      `);
    },

    postReceive: async (req: Request, params: Record<string, string>) => {
      try {
        const body = await req.json();
        console.log('Post-receive hook:', body);
        return jsonResponse({ status: 'ok', message: 'Placeholder: Hook received' });
      } catch (error) {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
    },
  };
}
