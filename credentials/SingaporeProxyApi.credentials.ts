import type { IAuthenticateGeneric, Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class SingaporeProxyApi implements ICredentialType {
	name = 'singaporeProxyApi';

	displayName = 'Singapore Proxy API';

	icon: Icon = {
		light: 'file:../icons/singaporeProxy.svg',
		dark: 'file:../icons/singaporeProxy.dark.svg',
	};

	documentationUrl =
		'https://github.com/Xavierfok/n8n-nodes-singapore-proxy?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Your key from singaporemobileproxy.com/client/mcp. New keys come with a free 24-hour trial (10 GB).',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};
}
