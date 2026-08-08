import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import {
  CLIENT_FLAG_DEFAULTS,
  parseClientFlags,
  type ClientFlagKey,
  type ClientFlags,
} from './definitions';

const FlagContext = createContext<ClientFlags>({ ...CLIENT_FLAG_DEFAULTS });

export function FlagProvider({
  authLoading,
  userId,
  children,
}: {
  authLoading: boolean;
  userId: string | null;
  children: ReactNode;
}) {
  const [flags, setFlags] = useState<ClientFlags>({ ...CLIENT_FLAG_DEFAULTS });

  useEffect(() => {
    if (authLoading) return;

    let active = true;
    setFlags({ ...CLIENT_FLAG_DEFAULTS });
    api
      .flags()
      .then(({ flags: receivedFlags }) => {
        if (active) setFlags(parseClientFlags(receivedFlags));
      })
      .catch(() => {
        if (active) setFlags({ ...CLIENT_FLAG_DEFAULTS });
      });

    return () => {
      active = false;
    };
  }, [authLoading, userId]);

  const value = useMemo(() => flags, [flags]);
  return <FlagContext.Provider value={value}>{children}</FlagContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFlag<Key extends ClientFlagKey>(key: Key): ClientFlags[Key] {
  return useContext(FlagContext)[key];
}
