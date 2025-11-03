export interface Route {
  pattern: RegExp;
  handler: (req: Request, params: Record<string, string>) => Response | Promise<Response>;
}

export type Middleware = (req: Request) => Promise<Response | null>;

export interface Router {
  get: (pattern: string, handler: Route['handler']) => void;
  post: (pattern: string, handler: Route['handler']) => void;
  use: (middleware: Middleware) => void;
  handle: (req: Request) => Response | Promise<Response>;
}

export function createRouter(): Router {
  const routes: Map<string, Route[]> = new Map([
    ['GET', []],
    ['POST', []],
  ]);
  const middlewares: Middleware[] = [];

  function addRoute(method: string, pattern: string, handler: Route['handler']): void {
    const paramNames: string[] = [];
    const regexPattern = pattern
      .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, (match) => {
        paramNames.push(match.slice(1));
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);

    routes.get(method)?.push({
      pattern: regex,
      handler: (req, params) => {
        const extractedParams: Record<string, string> = {};
        const url = new URL(req.url);
        const match = url.pathname.match(regex);
        
        if (match) {
          paramNames.forEach((name, index) => {
            extractedParams[name] = match[index + 1];
          });
        }

        return handler(req, extractedParams);
      },
    });
  }

  function use(middleware: Middleware): void {
    middlewares.push(middleware);
  }

  async function handle(req: Request): Promise<Response> {
    // Run middlewares first
    for (const middleware of middlewares) {
      const response = await middleware(req);
      if (response) {
        return response;
      }
    }

    const method = req.method;
    const url = new URL(req.url);
    const pathname = url.pathname;

    const methodRoutes = routes.get(method) || [];

    for (const route of methodRoutes) {
      if (route.pattern.test(pathname)) {
        try {
          return await route.handler(req, {});
        } catch (error) {
          console.error('Handler error:', error);
          return jsonError(500, 'Internal server error');
        }
      }
    }

    return jsonError(404, 'Not found');
  }

  return {
    get: (pattern, handler) => addRoute('GET', pattern, handler),
    post: (pattern, handler) => addRoute('POST', pattern, handler),
    use,
    handle,
  };
}

export function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonError(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

export function htmlResponse(html: string, status: number = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
