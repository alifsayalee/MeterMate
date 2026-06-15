import {
  AuthApi,
  ChatApi,
  Client,
  ConversationsApi,
  Environment,
  OauthScope,
  UsersApi,
} from 'slack-apimatic-sdk';
import { requireSlackConfig } from './config.js';

/**
 * Singleton Slack client + controllers.
 *
 * Token wiring (SDK-specific, abstracted here per the architecture): this SDK is
 * modelled around OAuth 2.0 and authenticates every call with an
 * `Authorization: Bearer <accessToken>` header. A Slack bot token (`xoxb-…`) is a
 * valid bearer credential, so we inject it as a pre-obtained `oauthToken` —
 * giving the bot-token app exactly the Bearer auth Slack expects, with no
 * authorization-code round-trip. The placeholder client id/secret/redirect are
 * required by the config type but never used (no token fetch happens because a
 * non-expiring token is already present). Nothing outside slackService depends on
 * this.
 */

let client: Client | undefined;

function getClient(): Client {
  if (client) return client;
  const { botToken } = requireSlackConfig();
  client = new Client({
    authorizationCodeAuthCredentials: {
      oauthClientId: 'metermate',
      oauthClientSecret: 'metermate',
      oauthRedirectUri: 'http://localhost',
      oauthScopes: [OauthScope.None],
      oauthToken: { accessToken: botToken, tokenType: 'Bearer' },
    },
    environment: Environment.Production,
    timeout: 30000,
  });
  return client;
}

export function authApi(): AuthApi {
  return new AuthApi(getClient());
}

export function usersApi(): UsersApi {
  return new UsersApi(getClient());
}

export function conversationsApi(): ConversationsApi {
  return new ConversationsApi(getClient());
}

export function chatApi(): ChatApi {
  return new ChatApi(getClient());
}
