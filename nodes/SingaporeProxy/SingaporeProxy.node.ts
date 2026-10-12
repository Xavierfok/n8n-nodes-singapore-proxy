import type {
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	IDataObject,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { MCP_ENDPOINT, McpSession, type McpHttpResponse, type McpTransport } from './mcp';

const TIMEOUT_MS = 120_000;

function toResponse(raw: {
	statusCode?: number;
	headers?: IDataObject;
	body?: unknown;
}): McpHttpResponse {
	const body = raw.body;
	return {
		statusCode: raw.statusCode ?? 0,
		headers: (raw.headers ?? {}) as Record<string, unknown>,
		body: typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body ?? ''),
	};
}

export class SingaporeProxy implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Singapore Proxy',
		name: 'singaporeProxy',
		icon: {
			light: 'file:../../icons/singaporeProxy.svg',
			dark: 'file:../../icons/singaporeProxy.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Fetch pages and run Google searches from a real Singapore mobile IP (Singtel or M1)',
		defaults: {
			name: 'Singapore Proxy',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'singaporeProxyApi',
				required: true,
				testedBy: 'singaporeProxyApiTest',
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Fetch URL',
						value: 'fetchUrl',
						description: 'Fetch a page through a Singapore mobile IP',
						action: 'Fetch a URL from singapore',
					},
					{
						name: 'Get Status',
						value: 'status',
						description: 'Show the current exit IP, carrier and remaining quota',
						action: 'Get proxy status',
					},
					{
						name: 'Google Search',
						value: 'searchGoogle',
						description: 'Run a Singapore-localized Google search (gl=sg)',
						action: 'Search google from singapore',
					},
					{
						name: 'Rotate IP',
						value: 'rotateIp',
						description: 'Get a fresh Singapore mobile IP',
						action: 'Rotate the IP',
					},
				],
				default: 'fetchUrl',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://www.example.sg/',
				description: 'The full http(s) URL to fetch',
				displayOptions: { show: { operation: ['fetchUrl'] } },
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'Markdown', value: 'markdown', description: 'Clean main content' },
					{ name: 'Text', value: 'text' },
					{ name: 'HTML', value: 'html' },
				],
				default: 'markdown',
				description: 'How the page comes back',
				displayOptions: { show: { operation: ['fetchUrl'] } },
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				description: 'What to search Google for',
				displayOptions: { show: { operation: ['searchGoogle'] } },
			},
			{
				displayName: 'Number of Results',
				name: 'num',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 20 },
				default: 10,
				description: 'How many organic results to return, 1-20 (server limit)',
				displayOptions: { show: { operation: ['searchGoogle'] } },
			},
		],
	};

	methods = {
		credentialTest: {
			async singaporeProxyApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const apiKey = String(credential.data?.apiKey ?? '');
				const send: McpTransport = async (headers, body) => {
					const res = await fetch(MCP_ENDPOINT, {
						method: 'POST',
						headers: { ...headers, 'x-api-key': apiKey },
						body: JSON.stringify(body),
						signal: AbortSignal.timeout(TIMEOUT_MS),
					});
					return {
						statusCode: res.status,
						headers: Object.fromEntries(res.headers.entries()),
						body: await res.text(),
					};
				};
				try {
					const status = await new McpSession(send).callTool('my_proxy_status');
					return { status: 'OK', message: status.split('\n')[0] || 'Connection successful' };
				} catch (error) {
					return { status: 'Error', message: (error as Error).message };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const send: McpTransport = async (headers, body) => {
			const raw = await this.helpers.httpRequestWithAuthentication.call(this, 'singaporeProxyApi', {
				method: 'POST',
				url: MCP_ENDPOINT,
				headers,
				body: JSON.stringify(body),
				encoding: 'text',
				json: false,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
				timeout: TIMEOUT_MS,
			});
			return toResponse(raw as { statusCode?: number; headers?: IDataObject; body?: unknown });
		};
		// One MCP session for the whole run.
		const session = new McpSession(send);

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				let result: string;
				if (operation === 'fetchUrl') {
					const url = this.getNodeParameter('url', i) as string;
					const format = this.getNodeParameter('format', i, 'markdown') as string;
					result = await session.callTool('fetch_url', { url, format });
				} else if (operation === 'searchGoogle') {
					const query = this.getNodeParameter('query', i) as string;
					const num = this.getNodeParameter('num', i, 10) as number;
					result = await session.callTool('search_google', { query, num });
				} else if (operation === 'rotateIp') {
					result = await session.callTool('rotate_ip');
				} else if (operation === 'status') {
					result = await session.callTool('my_proxy_status');
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
						itemIndex: i,
					});
				}
				returnData.push({ json: { operation, result }, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
