/**
 * Authenticated file download — native implementation.
 *
 * Files in FEMS are private: `/reports/:id/download` and `/files/download` both
 * require a bearer token, so a plain link would 401. This helper fetches with the
 * token the client already holds, writes the bytes into the app cache directory
 * and hands the file to the platform share sheet.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '../api/client-instance';
import { tokenStore } from '../auth/token-store';

export interface DownloadResult {
  saved: boolean;
  /** Where the file was written, when the platform reports it. */
  uri?: string;
  /** Set when nothing was written, so the caller can show a real reason. */
  reason?: string;
}

function safeName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'fems-file';
}

export async function downloadAuthenticatedFile(path: string, fileName: string): Promise<DownloadResult> {
  const tokens = await tokenStore.getTokens();
  if (!tokens?.accessToken) return { saved: false, reason: 'Your session has expired. Sign in again.' };

  try {
    const destination = new File(new Directory(Paths.cache, 'fems'), safeName(fileName));
    destination.parentDirectory.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(api.buildUrl(path), destination, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { dialogTitle: fileName });
      return { saved: true, uri: file.uri };
    }
    return { saved: true, uri: file.uri, reason: 'Saved to the app cache — no share sheet on this device.' };
  } catch (error) {
    return { saved: false, reason: error instanceof Error ? error.message : 'The download failed.' };
  }
}
