// A small client for the hosted Singapore Proxy MCP server (Streamable HTTP).
//
// One tool call is three requests: `initialize` (the reply carries an
// `mcp-session-id` header), a `notifications/initialized` notification, then
// `tools/call` with that session id. Replies are either JSON or a one-event SSE
// stream. The HTTP layer is passed in, so the same code runs inside a node's
// execute() and inside a credential test, and can be faked in tests.

export const MCP_ENDPOINT = 'https://mcp.singaporemobileproxy.com/mcp';
export const PROTOCOL_VERSION = '2025-06-18';

export interface McpHttpResponse {
	statusCode: number;
	headers: Record<string, unknown>;
	body: string;
}

export type McpTransport = (
	headers: Record<string, string>,
	body: Record<string, unknown>,
) => Promise<McpHttpResponse>;

export class McpToolError extends Error {}

interface JsonRpcReply {
	result?: {
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	};
	error?: { message?: string };
}

export function parseReply(response: McpHttpResponse): JsonRpcReply {
	const contentType = String(header(response.headers, 'content-type') ?? '');
	const text = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
	if (contentType.includes('text/event-stream')) {
		const data = text
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trim());
		if (data.length === 0) throw new McpToolError('Empty event stream from the server');
		return JSON.parse(data[data.length - 1]) as JsonRpcReply;
	}
	return JSON.parse(text) as JsonRpcReply;
}

function header(headers: Record<string, unknown>, name: string): unknown {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	return key === undefined ? undefined : headers[key];
}

function checkStatus(response: McpHttpResponse, step: string): void {
	if (response.statusCode >= 400) {
		throw new McpToolError(`Singapore Proxy server returned HTTP ${response.statusCode} on ${step}`);
	}
}

export class McpSession {
	private sessionId: string | undefined;

	private nextId = 0;

	constructor(private readonly send: McpTransport) {}

	private headers(): Record<string, string> {
		const h: Record<string, string> = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		};
		if (this.sessionId) {
			h['mcp-session-id'] = this.sessionId;
			h['mcp-protocol-version'] = PROTOCOL_VERSION;
		}
		return h;
	}

	private async open(): Promise<void> {
		this.sessionId = undefined;
		const init = await this.send(this.headers(), {
			jsonrpc: '2.0',
			id: ++this.nextId,
			method: 'initialize',
			params: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: 'n8n-nodes-singapore-proxy', version: '0.1.0' },
			},
		});
		checkStatus(init, 'initialize');
		const reply = parseReply(init);
		if (reply.error) throw new McpToolError(reply.error.message ?? 'initialize failed');
		const sid = header(init.headers, 'mcp-session-id');
		this.sessionId = sid === undefined ? undefined : String(sid);
		const note = await this.send(this.headers(), {
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		});
		checkStatus(note, 'notifications/initialized');
	}

	/** Run one tool and return its text output. Throws McpToolError on a tool error. */
	async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
		if (this.sessionId === undefined) await this.open();
		const payload = {
			jsonrpc: '2.0',
			id: ++this.nextId,
			method: 'tools/call',
			params: { name, arguments: args },
		};
		let response = await this.send(this.headers(), payload);
		if (response.statusCode === 404) {
			// The server forgot the session. Start a new one and try once more.
			await this.open();
			response = await this.send(this.headers(), payload);
		}
		checkStatus(response, name);
		const reply = parseReply(response);
		if (reply.error) throw new McpToolError(reply.error.message ?? `${name} failed`);
		const text = (reply.result?.content ?? [])
			.filter((part) => part.type === 'text')
			.map((part) => part.text ?? '')
			.join('\n');
		if (reply.result?.isError) throw new McpToolError(text || `${name} failed`);
		return text;
	}
}
