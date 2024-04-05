import * as admin from "./admin.json";

interface JSONRequest {
	name: string;
	token: string;
	trackId: string;
	partsCount: number;
}

export interface Env {
	KV: KVNamespace;
	BUCKET: R2Bucket;
}

function checkAdmin(auth: any): boolean {
	if (auth[0] === admin["name"] && auth[1] === admin["token"]) {
		return true;
	}
	return false;
}

async function checkHosting(auth: any, env: Env): Promise<boolean> {
	if (auth[0] === "lastRun" || auth[0] === "partsCount" || auth[0] === "sessionHostOwner") {
		return false;
	}
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

				return new Response();
			}
			if (path === "hosting/unregister") {
				if (!checkAdmin(auth)) {
					return new Response(null, { status: 401 });
				}

				const resources: JSONRequest = await request.json();
				await env.KV.delete(resources.name);

				return new Response();
			}

			if (path.startsWith("session/upload")) {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

				const user = auth![0];
				const sessionHostOwner = await env.KV.get("sessionHostOwner");
				if (sessionHostOwner === user) {
					await env.BUCKET.put(`server.${path.split("/")[2]}.tar`, request.body);
					return new Response();
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
					await env.KV.delete("sessionHostOwner");
					
					const resources: JSONRequest = await request.json();

					if (resources.partsCount === undefined) {
						return new Response();
					}

					const time = Math.floor(Date.now() / 1000).toString();
					await env.KV.put("lastRun", time);
					await env.KV.put("partsCount", (resources.partsCount + 1).toString());

					return Response.json({ time: time });
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
					const lastRun = await env.KV.get("lastRun") ?? "0";
					const partsCount = await env.KV.get("partsCount") ?? "0";
					return Response.json({
						status: "idle",
						lastRun: parseInt(lastRun),
						partsCount: parseInt(partsCount)
					});
				}

				return Response.json({
					status: "running",
					host: sessionHostOwner
				});
			}

			if (path.startsWith("session/update")) {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

				const user = auth![0];
				const sessionHostOwner = await env.KV.get("sessionHostOwner");
				if (sessionHostOwner === user) {
					return new Response((await env.BUCKET.get(`server.${path.split("/")[2]}.tar`))?.body);
				}
				
				return new Response(null, { status: 404 });
			}

			if (path === "session/start") {
				if (!checkAdmin(auth) && !await checkHosting(auth, env)) {
					return new Response(null, { status: 401 });
				}

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
			}
		}

		return new Response(null, { status: 501 });
	},
};