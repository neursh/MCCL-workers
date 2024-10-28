import { Env } from '.';

interface RouteOptions {
	startswithCheck: boolean;
}

export default class WorkersRouter {
	private routes = {
		GET: <Route[]>[],
		HEAD: <Route[]>[],
		POST: <Route[]>[],
		PUT: <Route[]>[],
		DELETE: <Route[]>[],
		CONNECT: <Route[]>[],
		OPTIONS: <Route[]>[],
		TRACE: <Route[]>[],
		PATCH: <Route[]>[],
	};

	get(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.GET.push(new Route(pathname, model, options));
	}

	head(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.HEAD.push(new Route(pathname, model, options));
	}

	post(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.POST.push(new Route(pathname, model, options));
	}

	put(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.PUT.push(new Route(pathname, model, options));
	}

	delete(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.DELETE.push(new Route(pathname, model, options));
	}

	connect(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.CONNECT.push(new Route(pathname, model, options));
	}

	options(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.OPTIONS.push(new Route(pathname, model, options));
	}

	trace(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.TRACE.push(new Route(pathname, model, options));
	}

	patch(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions = { startswithCheck: false }
	) {
		this.routes.PATCH.push(new Route(pathname, model, options));
	}

	async handle(request: Request, env: Env, ctx: ExecutionContext, state: any): Promise<Response> {
		const method = request.method;
		const { pathname } = new URL(request.url);

		let targetRoutes: Route[] | undefined = this.routes[method as keyof typeof this.routes];

		if (targetRoutes && targetRoutes.length > 0) {
			for (let routeIter = 0; routeIter < targetRoutes.length; routeIter++) {
				const route = targetRoutes[routeIter];
				if (
					route.options.startswithCheck
						? pathname.startsWith(route.pathname)
						: pathname === route.pathname
				) {
					return route.response(request, env, ctx, state);
				}
			}
		}

		return new Response(null, { status: 501 });
	}
}

class Route {
	pathname: string;
	private model: (
		request: Request,
		env: Env,
		ctx: ExecutionContext,
		state: any
	) => Promise<Response>;
	options: RouteOptions;

	constructor(
		pathname: string,
		model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>,
		options: RouteOptions
	) {
		this.pathname = pathname;
		this.model = model;
		this.options = options;
	}

	async response(request: Request, env: Env, ctx: ExecutionContext, state: any): Promise<Response> {
		return this.model(request, env, ctx, state);
	}
}
