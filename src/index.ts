import WorkersRouter from './router';

export interface Env {
	KV: KVNamespace;
	BUCKET: R2Bucket;
}

let KV_CACHE_sessionHostOwner: string | null = null;
async function getSessionHostOwner(env: Env) {
	if (!KV_CACHE_sessionHostOwner) {
		KV_CACHE_sessionHostOwner = await env.KV.get('sessionHostOwner');
	}
	return KV_CACHE_sessionHostOwner;
}
async function clearSessionHostOwner(env: Env) {
	await env.KV.delete('sessionHostOwner');
	KV_CACHE_sessionHostOwner = null;
}
async function setSessionHostOwner(env: Env, name: string) {
	await env.KV.put('sessionHostOwner', name);
	KV_CACHE_sessionHostOwner = name;
}

async function checkAuth(auth: string[] | undefined, env: Env): Promise<boolean> {
	if (!auth) {
		return false;
	}
	if (auth[0] === 'lastRun' || auth[0] === 'sessionHostOwner') {
		return false;
	}
	if (auth[1] === (await env.KV.get(auth[0]))) {
		return true;
	}
	return false;
}

const app = new WorkersRouter();

app.get('/session/createMultipartUpload', async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await getSessionHostOwner(env);

	if (sessionHostOwner === user) {
		const multipartUpload = await env.BUCKET.createMultipartUpload(state.multipartGlobalKey);
		return Response.json({
			key: multipartUpload.key,
			uploadId: multipartUpload.uploadId,
		});
	}

	return new Response(null, { status: 404 });
});

app.get('/session/createMultipartUpload', async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await getSessionHostOwner(env);

	if (sessionHostOwner === user) {
		const multipartUpload = await env.BUCKET.createMultipartUpload(state.multipartGlobalKey);
		return Response.json({
			key: multipartUpload.key,
			uploadId: multipartUpload.uploadId,
		});
	}

	return new Response(null, { status: 404 });
});

app.post(
	'/session/uploadPart',
	async (request, env, __, state) => {
		const user = state.auth[0];
		const sessionHostOwner = await getSessionHostOwner(env);
		const uploadId = state.searchParams.get('uploadId'),
			part = parseInt(state.searchParams.get('part') ?? '');

		if (sessionHostOwner === user && uploadId && !Number.isNaN(part) && request.body) {
			const multipartUpload = env.BUCKET.resumeMultipartUpload(state.multipartGlobalKey, uploadId);
			const uploadedPart: R2UploadedPart = await multipartUpload.uploadPart(part, request.body);

			return Response.json(uploadedPart);
		}

		return new Response(null, { status: 404 });
	},
	{ startswithCheck: true }
);

app.post(
	'/session/uploadComplete',
	async (request, env, _, state) => {
		const user = state.auth[0];
		const sessionHostOwner = await getSessionHostOwner(env);
		const uploadId = state.searchParams.get('uploadId');

		if (sessionHostOwner === user && uploadId) {
			const multipartUpload = env.BUCKET.resumeMultipartUpload(state.multipartGlobalKey, uploadId);

			await multipartUpload.complete(await request.json());

			return new Response();
		}

		return new Response(null, { status: 404 });
	},
	{ startswithCheck: true }
);

app.get(
	'/session/uploadAbort',
	async (_, env, __, state) => {
		const user = state.auth[0];
		const sessionHostOwner = await getSessionHostOwner(env);
		const uploadId = state.searchParams.get('uploadId');

		if (sessionHostOwner === user && uploadId) {
			const multipartUpload = env.BUCKET.resumeMultipartUpload(state.multipartGlobalKey, uploadId);

			await multipartUpload.abort();

			return new Response();
		}

		return new Response(null, { status: 404 });
	},
	{ startswithCheck: true }
);

app.get('/session/stop', async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await getSessionHostOwner(env);

	if (sessionHostOwner === user) {
		await clearSessionHostOwner(env);

		const time = Math.floor(Date.now() / 1000).toString();
		await env.KV.put('lastRun', time);

		return Response.json({ time: time });
	}

	return new Response(null, { status: 404 });
});

app.get('/session/check', async (_, env, __, ___) => {
	const sessionHostOwner = await getSessionHostOwner(env);
	if (sessionHostOwner === null) {
		const lastRun = (await env.KV.get('lastRun')) ?? '0';
		return Response.json({
			status: 'idle',
			lastRun: parseInt(lastRun),
		});
	}

	return Response.json({
		status: 'running',
		host: sessionHostOwner,
	});
});

app.get('/session/getServer', async (_, env, __, state) => {
	const length = parseInt(state.searchParams.get('getTo'));
	const user = state.auth[0];
	const sessionHostOwner = await getSessionHostOwner(env);
	if (sessionHostOwner === user) {
		if (!Number.isNaN(length)) {
			return new Response(
				(
					await env.BUCKET.get(state.multipartGlobalKey, { range: { offset: 0, length: length } })
				)?.body
			);
		}
		return new Response((await env.BUCKET.get(state.multipartGlobalKey))?.body);
	}

	return new Response(null, { status: 404 });
});

app.get('/session/getMapping', async (_, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await getSessionHostOwner(env);
	if (sessionHostOwner === user) {
		return new Response((await env.BUCKET.get(state.serverMapping))?.body);
	}

	return new Response(null, { status: 404 });
});

app.post('/session/uploadMapping', async (request, env, __, state) => {
	const user = state.auth[0];
	const sessionHostOwner = await getSessionHostOwner(env);
	if (sessionHostOwner === user) {
		await env.BUCKET.put(state.serverMapping, request.body);
		return new Response();
	}

	return new Response(null, { status: 404 });
});

app.get('/session/start', async (_, env, __, state) => {
	const sessionHostOwner = await getSessionHostOwner(env);

	if (sessionHostOwner === null) {
		await setSessionHostOwner(env, state.auth[0]);

		return Response.json({
			status: 'started',
			host: state.auth[0],
		});
	}

	return Response.json(
		{
			status: 'running',
			host: sessionHostOwner,
		},
		{ status: 403 }
	);
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { searchParams } = new URL(request.url);
		const auth: string[] | undefined = request.headers.get('Authorization')?.split(' ');

		if (!auth || !(await checkAuth(auth, env))) {
			return new Response(null, { status: 401 });
		}

		const state = {
			auth: auth,
			multipartGlobalKey: 'MCCLServer.tar',
			serverMapping: 'server.nlock.map',
			searchParams: searchParams,
		};

		return app.handle(request, env, ctx, state);
	},
};
