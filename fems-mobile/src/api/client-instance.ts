/**
 * The single HTTP client instance used by the whole app.
 *
 * Keeping it in its own module lets the auth provider wire the refresh callback
 * without creating an import cycle between the provider and the endpoints.
 */
import { ApiClient } from './client';
import { apiConfig } from './config';
import { tokenStore } from '../auth/token-store';

export const api = new ApiClient(apiConfig.baseUrl, tokenStore);
