import { router } from 'expo-router';

export function safeGoBack(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace('/');
}
