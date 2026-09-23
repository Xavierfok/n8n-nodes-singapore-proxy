// Runs against the compiled output in dist/ (npm test builds first).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { McpSession, McpToolError } = require('../dist/nodes/SingaporeProxy/mcp.js');
const { SingaporeProxy } = require('../dist/nodes/SingaporeProxy/SingaporeProxy.node.js');

function sse(message, extraHeaders = {}) {
	return {
		statusCode: 200,
		headers: { 'content-type': 'text/event-stream', ...extraHeaders },
		body: `event: message\ndata: ${JSON.stringify(message)}\n\n`,
	};
}

// Mimics the hosted server: initialize -> session id, then tools/call.
function fakeServer({ toolResult, expireFirstSession = false } = {}) {
	const calls = [];
	let sessions = 0;
	const send = async (headers, body) => {
		calls.push({ headers, body });
		if (body.method === 'initialize') {
			sessions += 1;
			return sse(
				{ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } },
				{ 'mcp-session-id': `s${sessions}` },
			);
		}
		if (body.method === 'notifications/initialized') return { statusCode: 202, headers: {}, body: '' };
		if (body.method === 'tools/call') {
			if (expireFirstSession && headers['mcp-session-id'] === 's1') {
				return { statusCode: 404, headers: {}, body: '' };
			}
			const result =
				typeof toolResult === 'function'
					? toolResult(body.params)
					: toolResult ?? { content: [{ type: 'text', text: `ran ${body.params.name}` }] };
			return sse({ jsonrpc: '2.0', id: body.id, result });
		}
		return { statusCode: 400, headers: {}, body: '' };
	};
	return { send, calls, sessions: () => sessions };
}

test('handshake, then tools/call with the session id', async () => {
	const server = fakeServer();
	const out = await new McpSession(server.send).callTool('fetch_url', { url: 'https://example.com', format: 'text' });
	assert.equal(out, 'ran fetch_url');
	assert.deepEqual(
		server.calls.map((c) => c.body.method),
		['initialize', 'notifications/initialized', 'tools/call'],
	);
	const last = server.calls.at(-1);
	assert.equal(last.headers['mcp-session-id'], 's1');
	assert.deepEqual(last.body.params, { name: 'fetch_url', arguments: { url: 'https://example.com', format: 'text' } });
});

test('reuses the session across calls', async () => {
	const server = fakeServer();
	const session = new McpSession(server.send);
	await session.callTool('my_proxy_status');
	await session.callTool('rotate_ip');
	assert.equal(server.sessions(), 1);
});

test('re-initializes once when the server forgot the session', async () => {
	const server = fakeServer({ expireFirstSession: true });
	const out = await new McpSession(server.send).callTool('search_google', { query: 'kopi', num: 3 });
	assert.equal(out, 'ran search_google');
	assert.equal(server.sessions(), 2);
});

test('tool errors surface the server message', async () => {
	const server = fakeServer({
		toolResult: {
			content: [{ type: 'text', text: 'Error executing tool my_proxy_status: API key is invalid.' }],
			isError: true,
		},
	});
	await assert.rejects(new McpSession(server.send).callTool('my_proxy_status'), (err) => {
		assert.ok(err instanceof McpToolError);
		assert.match(err.message, /API key is invalid/);
		return true;
	});
});

test('plain JSON replies are parsed too', async () => {
	const send = async (headers, body) => {
		if (body.method === 'initialize') {
			return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'j' }, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }) };
		}
		if (body.method === 'notifications/initialized') return { statusCode: 202, headers: {}, body: '' };
		assert.equal(headers['mcp-session-id'], 'j');
		return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'json ok' }] } }) };
	};
	assert.equal(await new McpSession(send).callTool('my_proxy_status'), 'json ok');
});

// A minimal stand-in for n8n's IExecuteFunctions.
function fakeContext(items, server, { continueOnFail = false } = {}) {
	return {
		getInputData: () => items.map((p) => ({ json: {} })),
		getNodeParameter: (name, i, fallback) => (name in items[i] ? items[i][name] : fallback),
		getNode: () => ({ name: 'Singapore Proxy', type: 'n8n-nodes-singapore-proxy.singaporeProxy', typeVersion: 1, parameters: {} }),
		continueOnFail: () => continueOnFail,
		helpers: {
			async httpRequestWithAuthentication(credentialType, options) {
				assert.equal(credentialType, 'singaporeProxyApi');
				assert.equal(options.url, 'https://mcp.singaporemobileproxy.com/mcp');
				assert.equal(options.returnFullResponse, true);
				return server.send(options.headers, JSON.parse(options.body));
			},
		},
	};
}

test('execute maps each operation to the right server tool', async () => {
	const server = fakeServer({ toolResult: (params) => ({ content: [{ type: 'text', text: JSON.stringify(params) }] }) });
	const items = [
		{ operation: 'fetchUrl', url: 'https://www.example.sg/', format: 'html' },
		{ operation: 'searchGoogle', query: 'chilli crab', num: 5 },
		{ operation: 'rotateIp' },
		{ operation: 'status' },
	];
	const [out] = await new SingaporeProxy().execute.call(fakeContext(items, server));
	const sent = out.map((o) => JSON.parse(o.json.result));
	assert.deepEqual(sent, [
		{ name: 'fetch_url', arguments: { url: 'https://www.example.sg/', format: 'html' } },
		{ name: 'search_google', arguments: { query: 'chilli crab', num: 5 } },
		{ name: 'rotate_ip', arguments: {} },
		{ name: 'my_proxy_status', arguments: {} },
	]);
	assert.deepEqual(out.map((o) => o.pairedItem.item), [0, 1, 2, 3]);
	assert.equal(server.sessions(), 1);
});

test('execute throws on a tool error, or records it with continueOnFail', async () => {
	const bad = { content: [{ type: 'text', text: 'API key is invalid.' }], isError: true };
	const items = [{ operation: 'status' }];
	await assert.rejects(
		new SingaporeProxy().execute.call(fakeContext(items, fakeServer({ toolResult: bad }))),
		/API key is invalid/,
	);
	const [out] = await new SingaporeProxy().execute.call(
		fakeContext(items, fakeServer({ toolResult: bad }), { continueOnFail: true }),
	);
	assert.match(out[0].json.error, /API key is invalid/);
});
