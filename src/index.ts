export interface Env {
	KV: KVNamespace;
	BUCKET: R2Bucket;
}

interface RouteOptions {
	startswithCheck: boolean;
}

class Route {
	pathname: string;
	private model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>;
	options: RouteOptions;

	constructor(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions) {
		this.pathname = pathname;
		this.model = model;
		this.options = options;
	}

	async response(request: Request, env: Env, ctx: ExecutionContext, state: any): Promise<Response> {
		return this.model(request, env, ctx, state);
	}
}

class WorkersRouter {
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

	get(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.GET.push(new Route(pathname, model, options));
	}

	head(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.HEAD.push(new Route(pathname, model, options));
	}

	post(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.POST.push(new Route(pathname, model, options));
	}

	put(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.PUT.push(new Route(pathname, model, options));
	}

	delete(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.DELETE.push(new Route(pathname, model, options));
	}

	connect(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.CONNECT.push(new Route(pathname, model, options));
	}

	options(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.OPTIONS.push(new Route(pathname, model, options));
	}

	trace(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.TRACE.push(new Route(pathname, model, options));
	}

	patch(pathname: string, model: (request: Request, env: Env, ctx: ExecutionContext, state: any) => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.routes.PATCH.push(new Route(pathname, model, options));
	}

	async handle(request: Request, env: Env, ctx: ExecutionContext, state: any): Promise<Response> {
		const method = request.method;
		const { pathname } = new URL(request.url);

		let targetRoutes: Route[] | undefined = this.routes[method as keyof typeof this.routes];

		if (targetRoutes && targetRoutes.length > 0) {
			for (let routeIter = 0; routeIter < targetRoutes.length; routeIter++) {
				const route = targetRoutes[routeIter];
				if (route.options.startswithCheck ? pathname.startsWith(route.pathname) : pathname === route.pathname) {
					return route.response(request, env, ctx, state);
				}
			}
		}

		return new Response(null, { status: 501 });
	}
}

async function checkAuth(auth: string[] | undefined, env: Env): Promise<boolean> {
	if (!auth) {
		return false;
	}
	if (auth[0] === "lastRun" || auth[0] === "sessionHostOwner") {
		return false;
	}
	if (auth[1] === await env.KV.get(auth[0])) {
		return true;
	}
	return false;
}

const app = new WorkersRouter();

app.get("/session/createMultipartUpload", async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");

	if (sessionHostOwner === user) {
		const multipartUpload = await env.BUCKET.createMultipartUpload(state.multipartGlobalKey);
		return Response.json({
			key: multipartUpload.key,
			uploadId: multipartUpload.uploadId,
		});
	}

	return new Response(null, { status: 404 });
});

app.get("/session/createMultipartUpload", async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");

	if (sessionHostOwner === user) {
		const multipartUpload = await env.BUCKET.createMultipartUpload(state.multipartGlobalKey);
		return Response.json({
			key: multipartUpload.key,
			uploadId: multipartUpload.uploadId,
		});
	}

	return new Response(null, { status: 404 });
});

app.post("/session/uploadPart", async (request, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");
	const uploadId = state.searchParams.get("uploadId"),
	part = parseInt(state.searchParams.get("part") ?? "");

	if (sessionHostOwner === user && uploadId && !Number.isNaN(part) && request.body) {
		const multipartUpload = env.BUCKET.resumeMultipartUpload(state.multipartGlobalKey, uploadId);
		const uploadedPart: R2UploadedPart = await multipartUpload.uploadPart(part, request.body);

		return Response.json(uploadedPart);
	}

	return new Response(null, { status: 404 });
}, { startswithCheck: true });

app.post("/session/uploadComplete", async (request, env, _, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");
	const uploadId = state.searchParams.get("uploadId");

	if (sessionHostOwner === user && uploadId) {
		const multipartUpload = env.BUCKET.resumeMultipartUpload(state.multipartGlobalKey, uploadId);

		await multipartUpload.complete(await request.json());

		return new Response();
	}

	return new Response(null, { status: 404 });
}, { startswithCheck: true });

app.get("/session/uploadAbort", async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");
	const uploadId = state.searchParams.get("uploadId");

	if (sessionHostOwner === user && uploadId) {
		const multipartUpload = env.BUCKET.resumeMultipartUpload(state.multipartGlobalKey, uploadId);

		await multipartUpload.abort();

		return new Response();
	}

	return new Response(null, { status: 404 });
}, { startswithCheck: true });

app.get("/session/stop", async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");

	if (sessionHostOwner === user) {
		await env.KV.delete("sessionHostOwner");

		const time = Math.floor(Date.now() / 1000).toString();
		await env.KV.put("lastRun", time);

		return Response.json({ time: time });
	}

	return new Response(null, { status: 404 });
});

app.get("/session/check", async (_, env, __, ___) => {
	const sessionHostOwner = await env.KV.get("sessionHostOwner");
	if (sessionHostOwner === null) {
		const lastRun = await env.KV.get("lastRun") ?? "0";
		return Response.json({
			status: "idle",
			lastRun: parseInt(lastRun),
		});
	}

	return Response.json({
		status: "running",
		host: sessionHostOwner
	});
});

app.get("/session/getServer", async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");
	if (sessionHostOwner === user) {
		return new Response((await env.BUCKET.get(state.multipartGlobalKey))?.body);
	}
		
	return new Response(null, { status: 404 });
});

app.get("/session/getMapping", async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");
	if (sessionHostOwner === user) {
		return new Response((await env.BUCKET.get(state.serverMapping))?.body);
	}
		
	return new Response(null, { status: 404 });
});

app.post("/session/uploadMapping", async (request, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await env.KV.get("sessionHostOwner");
	if (sessionHostOwner === user) {
		env.BUCKET.put(state.serverMapping, request.body);
		return new Response();
	}
		
	return new Response(null, { status: 404 });
});

app.get("/session/start", async (_, env, __, state) => {
	const sessionHostOwner = await env.KV.get("sessionHostOwner");

	if (sessionHostOwner === null) {
		await env.KV.put("sessionHostOwner", state.auth[0]);

		return Response.json({
			status: "started",
			host: state.auth[0]
		});
	}

	return Response.json({
		status: "running",
		host: sessionHostOwner,
	}, { status: 403 });
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { searchParams } = new URL(request.url);
		const auth: string[] | undefined = request.headers.get("Authorization")?.split(" ");

		if (!auth || !await checkAuth(auth, env)) {
			return new Response(null, { status: 401 });
		}

		const state = {
			auth: auth,
			multipartGlobalKey: "MCCLServer.tar",
			serverMapping: "server.nlock.map",
			searchParams: searchParams,
		};

		return app.handle(request, env, ctx, state);
	},
};