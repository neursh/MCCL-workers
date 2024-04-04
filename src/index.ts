import * as admin from "./admin.json";

interface JSONRequest {
	name: string;
	token: string;
	trackId: string;
}

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	KV: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

function checkAdmin(auth: any): boolean {
	if (auth[0] === admin["name"] && auth[1] === admin["token"]) {
		return true;
	}
	return false;
}

async function checkHosting(auth: any, env: Env): Promise<boolean> {
	if (auth[1] === await env.KV.get(auth[0])) {
		return true;
	}
	return false;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const {
			pathname
		} = new URL(request.url);

		const path = pathname.replace(/^\/|\/$/g, "");

		const auth = request.headers.get("Authorization")?.split(" ");

		if (request.method === "POST") {
			if (path == "hosting/register") {
				if (!checkAdmin(auth)) {
					return new Response(null, { status: 401 });
				}

				const resources: JSONRequest = await request.json();
				await env.KV.put(resources.name, resources.token);

				return new Response(null);
			}
			if (path === "hosting/unregister") {
				if (!checkAdmin(auth)) {
					return new Response(null, { status: 401 });
				}

				const resources: JSONRequest = await request.json();
				await env.KV.delete(resources.name);

				return new Response(null);
			}

			if (path === "session/start") {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

				const resources: JSONRequest = await request.json();

				const sessionHostOwner = await env.KV.get("sessionHostOwner");
				if (sessionHostOwner === null) {
					await env.KV.put("sessionHostOwner", auth![0]);
					await env.KV.put("sessionTrackId", resources.trackId);

					return Response.json({
						status: "started",
						host: auth![0]
					});
				}

				return Response.json({
					status: "running",
					host: sessionHostOwner,
				}, { status: 403 });
			}

			if (path.startsWith("session/file/upload")) {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

				const user = auth![0];
				const sessionHostOwner = await env.KV.get("sessionHostOwner");
				if (sessionHostOwner === user) {
					await env.BUCKET.put(`${path.slice(20)}`, request.body);
					return new Response(null);
				}
				return new Response(null, { status: 401 });
			}
			if (path.startsWith("session/file/delete")) {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

				const user = auth![0];
				const sessionHostOwner = await env.KV.get("sessionHostOwner");
				if (sessionHostOwner === user) {
					await env.BUCKET.delete(`${path.slice(20)}`);
					return new Response(null);
				}

				return new Response(null, { status: 404 });
			}

			if (path === "session/stop") {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

				const user = auth![0];
				const sessionHostOwner = await env.KV.get("sessionHostOwner");
				if (sessionHostOwner === user) {
					await env.BUCKET.put(`track.log`, request.body);
					await env.KV.put("latestTrackId", (await env.KV.get("sessionTrackId"))!);
					await env.KV.delete("sessionHostOwner");

					return new Response(null);
				}
				return new Response(null, { status: 404 });
			}
		}

		if (request.method === "GET") {
			if (path === "session/check") {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

				const sessionHostOwner = await env.KV.get("sessionHostOwner");
				if (sessionHostOwner === null) {
					const latestTrackId = await env.KV.get("latestTrackId");
					return Response.json({
						status: "idle",
						latest: latestTrackId,
					});
				}

				return Response.json({
					status: "running",
					host: sessionHostOwner
				});
			}
		}

		return new Response(null, { status: 501 });
	},
};