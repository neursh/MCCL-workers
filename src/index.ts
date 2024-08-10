interface CompleteJsonRequest {
	name: string;
	token: string;
	trackId: string;
	partsCount: number;
}

interface MultipartJsonRequest {
	key: string;
}

export interface Env {
	KV: KVNamespace;
	BUCKET: R2Bucket;
}

interface RouteOptions {
	startswithCheck: boolean;
}

class RouteBuilder {
	pathname: string;
	private model: () => Promise<Response>;
	options: RouteOptions;

	constructor(pathname: string, model: () => Promise<Response>, options: RouteOptions) {
		this.pathname = pathname;
		this.model = model;
		this.options = options;
	}

	async response(): Promise<Response> {
		return this.model();
	}
}

class WorkersApp {
	private getRoutes: RouteBuilder[] = [];
	private postRoutes: RouteBuilder[] = [];

	get(pathname: string, model: () => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.getRoutes.push(new RouteBuilder(pathname, model, options));
	}

	post(pathname: string, model: () => Promise<Response>, options: RouteOptions = { startswithCheck: false }) {
		this.postRoutes.push(new RouteBuilder(pathname, model, options));
	}

	async handle(pathname: string, method: string): Promise<Response> {
		let targetRoutes: RouteBuilder[] | null = null;

		if (method === "GET") {
			targetRoutes = this.getRoutes;
		} else if (method === "POST") {
			targetRoutes = this.postRoutes;
		}

		if (targetRoutes !== null) {
			for (let routeIter = 0; routeIter < targetRoutes.length; routeIter++) {
				const route = targetRoutes[routeIter];
				if (route.options.startswithCheck ? pathname.startsWith(route.pathname) : pathname === route.pathname) {
					return route.response();
				}
			}
		}

		return new Response(null, { status: 501 });
	}
}

async function checkHosting(auth: any, env: Env): Promise<boolean> {
	if (auth[0] === "lastRun" || auth[0] === "sessionHostOwner") {
		return false;
	}
	if (auth[1] === await env.KV.get(auth[0])) {
		return true;
	}
	return false;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname, searchParams } = new URL(request.url);
		const auth = request.headers.get("Authorization")?.split(" ");
		const multipartGlobalKey = "MCCLServer.tar";

		if (!await checkHosting(auth, env)) {
			return new Response(null, { status: 401 });
		}

		const app = new WorkersApp();

		app.get("/session/createMultipartUpload", async () => {
			const user = auth![0];
			const sessionHostOwner = await env.KV.get("sessionHostOwner");

			if (sessionHostOwner === user) {
				const multipartUpload = await env.BUCKET.createMultipartUpload(multipartGlobalKey);
				return Response.json({
					key: multipartUpload.key,
					uploadId: multipartUpload.uploadId,
				});
			}

			return new Response(null, { status: 404 });
		});

		app.post("/session/uploadPart", async () => {
			const user = auth![0];
			const sessionHostOwner = await env.KV.get("sessionHostOwner");
			const uploadId = searchParams.get("uploadId"),
			part = parseInt(searchParams.get("part") ?? "");

			if (sessionHostOwner === user && uploadId && !Number.isNaN(part) && request.body) {
				const multipartUpload = env.BUCKET.resumeMultipartUpload(multipartGlobalKey, uploadId);
				const uploadedPart: R2UploadedPart = await multipartUpload.uploadPart(part, request.body);

				return Response.json(uploadedPart);
			}

			return new Response(null, { status: 404 });
		}, { startswithCheck: true });

		app.post("/session/uploadComplete", async () => {
			const user = auth![0];
			const sessionHostOwner = await env.KV.get("sessionHostOwner");
			const uploadId = searchParams.get("uploadId");

			if (sessionHostOwner === user && uploadId) {
				const multipartUpload = env.BUCKET.resumeMultipartUpload(multipartGlobalKey, uploadId);

				await multipartUpload.complete(await request.json());

				return new Response();
			}

			return new Response(null, { status: 404 });
		}, { startswithCheck: true });

		app.get("/session/uploadAbort", async () => {
			const user = auth![0];
			const sessionHostOwner = await env.KV.get("sessionHostOwner");
			const uploadId = searchParams.get("uploadId");

			if (sessionHostOwner === user && uploadId) {
				const multipartUpload = env.BUCKET.resumeMultipartUpload(multipartGlobalKey, uploadId);

				await multipartUpload.abort();

				return new Response();
			}

			return new Response(null, { status: 404 });
		}, { startswithCheck: true });

		app.get("/session/stop", async () => {
			const user = auth![0];
			const sessionHostOwner = await env.KV.get("sessionHostOwner");

			if (sessionHostOwner === user) {
				await env.KV.delete("sessionHostOwner");
	
				const time = Math.floor(Date.now() / 1000).toString();
				await env.KV.put("lastRun", time);
	
				return Response.json({ time: time });
			}

			return new Response(null, { status: 404 });
		});

		app.get("/session/check", async () => {
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

		app.get("/session/getServer", async () => {
			const user = auth![0];
			const sessionHostOwner = await env.KV.get("sessionHostOwner");
			if (sessionHostOwner === user) {
				return new Response((await env.BUCKET.get(multipartGlobalKey))?.body);
			}
				
			return new Response(null, { status: 404 });
		});

		app.get("/session/start", async () => {
			const sessionHostOwner = await env.KV.get("sessionHostOwner");
			if (sessionHostOwner === null) {
				await env.KV.put("sessionHostOwner", auth![0]);
	
				return Response.json({
					status: "started",
					host: auth![0]
				});
			}
	
			return Response.json({
				status: "running",
				host: sessionHostOwner,
			}, { status: 403 });
		});

		return app.handle(pathname, request.method);
	},
};