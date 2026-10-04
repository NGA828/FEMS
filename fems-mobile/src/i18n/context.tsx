import React, { createContext, useContext } from 'react';
import { translateAppText, type AppLanguage } from './translate';

export interface LocaleContextValue {
  language: AppLanguage;
  translate: (value: string) => string;
}

export const LocaleContext = createContext<LocaleContextValue>({
  language: 'en',
  translate: (value) => value,
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

export { translateAppText };
