/**
 * Authenticated file download — web implementation.
 *
 * The report and evidence endpoints require a bearer token, so the browser fetch
 * carries it, the response becomes a blob URL and an anchor click hands it to the
 * browser's own download handling. No token ever appears in a URL.
 */
import { api } from '../api/client-instance';
import { tokenStore } from '../auth/token-store';
import type { DownloadResult } from './file-download';

export async function downloadAuthenticatedFile(path: string, fileName: string): Promise<DownloadResult> {
  const tokens = await tokenStore.getTokens();
  if (!tokens?.accessToken) return { saved: false, reason: 'Your session has expired. Sign in again.' };

  try {
    const response = await fetch(api.buildUrl(path), {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!response.ok) {
      return { saved: false, reason: `The server refused the download (HTTP ${response.status}).` };
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser a moment to start the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { saved: true };
  } catch (error) {
    return { saved: false, reason: error instanceof Error ? error.message : 'The download failed.' };
  }
}
