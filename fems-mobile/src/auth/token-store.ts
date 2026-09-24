/**
 * Token persistence.
 *
 * On iOS/Android the pair lives in the platform keystore (Keychain / EncryptedSharedPreferences)
 * through `expo-secure-store`. SecureStore has no web implementation, so the web build — a
 * development and preview surface only — falls back to AsyncStorage and says so in the UI
 * (see the session banner in the profile screen).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { TokenBundle, TokenStore } from '../api/client';

const ACCESS_KEY = 'fems.accessToken';
const REFRESH_KEY = 'fems.refreshToken';
const EXPIRY_KEY = 'fems.accessTokenExpiresAt';

const secureAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

async function readKey(key: string): Promise<string | null> {
  if (secureAvailable) return SecureStore.getItemAsync(key);
  return AsyncStorage.getItem(key);
}

async function writeKey(key: string, value: string | null): Promise<void> {
  if (secureAvailable) {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED });
    return;
  }
  if (value === null) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, value);
}

export class PersistentTokenStore implements TokenStore {
  private cache: TokenBundle | null = null;
  private loaded = false;

  async getTokens(): Promise<TokenBundle | null> {
    if (this.loaded) return this.cache;
    const [accessToken, refreshToken, expiresAt] = await Promise.all([
      readKey(ACCESS_KEY),
      readKey(REFRESH_KEY),
      readKey(EXPIRY_KEY),
    ]);
    this.loaded = true;
    this.cache =
      accessToken && refreshToken
        ? {
            accessToken,
            refreshToken,
            expiresIn: expiresAt ? Math.max(0, Math.round((Number(expiresAt) - Date.now()) / 1000)) : undefined,
          }
        : null;
    return this.cache;
  }

  async setTokens(tokens: TokenBundle | null): Promise<void> {
    this.loaded = true;
    this.cache = tokens;
    await Promise.all([
      writeKey(ACCESS_KEY, tokens?.accessToken ?? null),
      writeKey(REFRESH_KEY, tokens?.refreshToken ?? null),
      writeKey(EXPIRY_KEY, tokens?.expiresIn ? String(Date.now() + tokens.expiresIn * 1000) : null),
    ]);
  }

  /** True when the access token is inside the last 30 seconds of its lifetime. */
  async isExpiring(): Promise<boolean> {
    const expiresAt = await readKey(EXPIRY_KEY);
    if (!expiresAt) return false;
    return Number(expiresAt) - Date.now() < 30_000;
  }

  /** True when the tokens are held in the platform keystore rather than AsyncStorage. */
  get usesSecureStorage(): boolean {
    return secureAvailable;
  }
}

export const tokenStore = new PersistentTokenStore();
