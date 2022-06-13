import {
  ComponentType,
  Context,
  Dispatch,
  ReactNode,
  SetStateAction,
} from 'react';
import type { ClientRoute, RouteDataFunction } from '@remix-run/react/routes';
import type {
  HandoffData,
  PolyglotOptionsGetter,
  PolyglotWithStaticLocale,
} from './common';
import {
  useContext,
  createContext,
  useState,
  createElement,
  Fragment,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import { RemixEntryContext } from '@remix-run/react/components';
import batcher from 'ichschwoer/batch-resolve';
import {
  getRouteNamespaces,
  getGlobalName,
  isRecordOfStrings,
  isRecord,
  initiatePolyglot,
} from './common';

export type { PolyglotWithStaticLocale } from './common';
export { getHandleNamespaces } from './common';

type Args = Parameters<RouteDataFunction>[0];
type ContextType<T extends Context<any>> = Parameters<
  Parameters<T['Consumer']>[0]['children']
>[0];
interface Caches {
  phrases: Record<string, Promise<Record<string, any>> | undefined>;
  indexes: Record<string, Promise<Record<string, string>> | undefined>;
}
type RemixEntryContextType = Exclude<
  ContextType<typeof RemixEntryContext>,
  undefined
>;

export function useRemixEntryContext(): RemixEntryContextType {
  const context = useContext(RemixEntryContext);

  if (!context) {
    throw new Error('Could not use remix entry context outside of Remix');
  }

  return context;
}

interface RemixPolyglotContextType {
  loadPhrases: (
    namespace: string | string[],
    signal: AbortSignal,
    locale?: string,
  ) => Promise<void>;
  store: Record<string, PolyglotWithStaticLocale>;
  _patched: symbol;
  setLocale: Dispatch<SetStateAction<string>>;
  preloadTranslations?: (
    args: Omit<Args, 'signal'>,
  ) => { locale?: string; namespaces?: string | string[] } | undefined;
  routeNamespaces: HandoffData['routeNamespaces'];
  initialPreload: string[];
  locale: string;
}

const RemixPolyglotContext = createContext<
  undefined | RemixPolyglotContextType
>(undefined);

interface SetupOptions {
  manifest: Record<string, string>;
  fetch?: typeof fetch;
  preloadTranslations?: RemixPolyglotContextType['preloadTranslations'];
  polyglotOptions?: PolyglotOptionsGetter;
}

export async function setup(
  options: SetupOptions,
): Promise<ComponentType<{ children?: ReactNode }>> {
  const handoffData = (window as any)[getGlobalName()] as HandoffData;
  const caches = {
    indexes: {},
    phrases: {},
  };

  const initialStore: Record<string, PolyglotWithStaticLocale> =
    Object.fromEntries(
      await Promise.all(
        getRouteNamespaces(__remixRouteModules).map(async (namespace) =>
          initiatePolyglot(
            handoffData.locale,
            namespace,
            options.polyglotOptions,
            await load(namespace, options, handoffData, caches),
          ),
        ),
      ),
    );

  const initialPreload: string[] = [];
  document.querySelectorAll(`[data-i18n-preload]`).forEach(($el) => {
    initialPreload.push($el.getAttribute('href')!);
  });

  return function RemixPolyglotProvider({ children }) {
    const [store, updateStore] = useState(initialStore);
    const [locale, setLocale] = useState<string>(handoffData.locale);
    const loadPhrases = useCallback(
      async (
        namespace: string | string[],
        signal: AbortSignal,
        nextLocale?: string,
      ) => {
        const more = Object.fromEntries(
          await Promise.all(
            (Array.isArray(namespace) ? namespace : [namespace]).map(
              async (ns) =>
                initiatePolyglot(
                  nextLocale || locale,
                  ns,
                  options.polyglotOptions,
                  await load(
                    ns,
                    options,
                    { ...handoffData, locale: nextLocale || locale },
                    caches,
                    signal,
                  ),
                ),
            ),
          ),
        );

        updateStore((current) => ({ ...current, ...more }));
      },
      [locale],
    );
    const _patched = useMemo(() => Symbol('🙈'), []);
    const ctx = useMemo(
      (): RemixPolyglotContextType => ({
        loadPhrases,
        store,
        _patched,
        locale,
        setLocale,
        initialPreload,
        preloadTranslations: options.preloadTranslations,
        routeNamespaces: handoffData.routeNamespaces,
      }),
      [loadPhrases, store, locale, _patched],
    );

    return (
      <RemixPolyglotContext.Provider value={ctx}>
        {children}
      </RemixPolyglotContext.Provider>
    );
  };
}

const noop = () => {
  /* ¯\_(ツ)_/¯ */
};

export function Handoff() {
  const { clientRoutes } = useRemixEntryContext();
  const {
    loadPhrases,
    routeNamespaces,
    _patched,
    setLocale,
    initialPreload,
    preloadTranslations,
  } = useRemixPolyglotContext();

  useEffect(() => {
    const batch = batcher(0);
    const patch = (route: ClientRoute) => {
      if (!(route as any)[_patched]) {
        (route as any)[_patched] = {};
      }

      ['loader' as const, 'action' as const].forEach((method) => {
        const original = (route as any)[_patched][method] || route[method];
        (route as any)[_patched][method] = original;

        if (original) {
          route[method] = async (args) => {
            const ref = batch.ref;
            const { signal, ...preloadArgs } = args;
            const { locale, namespaces = routeNamespaces[route.id] } =
              (typeof preloadTranslations === 'function' &&
                preloadTranslations(preloadArgs)) ||
              {};
            const promisedPhrases = namespaces
              ? loadPhrases(namespaces, args.signal, locale)
              : undefined;
            const allPhrasesLoaded = batch.push(promisedPhrases);

            const [res] = await Promise.all([
              original(args),
              promisedPhrases?.catch((err) => {
                if (err instanceof Error && err.name === 'AbortError') {
                  /* ¯\_(ツ)_/¯ */
                  return;
                } else {
                  console.error(err);
                }
              }),
            ]);

            if (!ref.current && locale) {
              ref.current = true;
              allPhrasesLoaded
                .then(() => {
                  setLocale(locale);
                })
                .catch(noop);
            } else {
              allPhrasesLoaded.catch(noop);
            }

            return res;
          };
        }
      });

      route.children?.forEach(patch);
    };

    clientRoutes.forEach(patch);
  }, [
    clientRoutes,
    routeNamespaces,
    loadPhrases,
    _patched,
    preloadTranslations,
  ]);

  return (
    <>
      {initialPreload.map((href) => (
        <link
          key={href}
          rel="prefetch"
          data-i18n-preload
          as="json"
          href={href}
        />
      ))}
    </>
  );
}

export function usePolyglot(namespace: string = 'common') {
  const { store, locale } = useRemixPolyglotContext();
  const id = `${locale}-${namespace}`;

  if (!store[id]) {
    throw new Error(`Unknown namespace ${namespace} in ${locale}`);
  }
  return store[id];
}

export function useLocale(): string {
  const ctx = useRemixPolyglotContext();
  return ctx.locale;
}

function useRemixPolyglotContext() {
  const ctx = useContext(RemixPolyglotContext);
  if (!ctx) {
    throw new Error(
      'Must useRemixPolyglotContext inside component returned from setup',
    );
  }
  return ctx;
}

async function load(
  namespace: string,
  { fetch = window.fetch, manifest }: Pick<SetupOptions, 'fetch' | 'manifest'>,
  { locale, baseUrl }: HandoffData,
  { phrases, indexes }: Caches,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  const id = `${locale}-${namespace}`;
  if (phrases[id]) {
    return phrases[id]!;
  }
  if (!manifest[locale]) {
    throw new Error(`Missing index for ${locale}`);
  }

  if (!indexes[locale]) {
    indexes[locale] = new Promise(async (resolve, reject) => {
      try {
        const res = await fetch(`${baseUrl}/${locale}/${manifest[locale]}`, {
          signal,
        });
        if (String(res.status)[0] !== '2') {
          throw new Error('Failed to load');
        }
        const index = await res.json();
        if (!isRecordOfStrings(index)) {
          throw new Error('Invalid format');
        }
        resolve(index);
      } catch (err) {
        delete indexes[locale];
        if (err instanceof Error && err.name === 'AbortError') {
          reject(err);
        } else {
          reject(
            new Error(
              `Could not read index for ${locale}. Reason: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
        }
      }
    });
  }

  const index = await indexes[locale]!;
  if (!index[namespace]) {
    throw new Error(`Missing namespace ${namespace} on locale ${locale}`);
  }

  phrases[id] = new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(`${baseUrl}/${locale}/${index[namespace]}`, {
        signal,
      });
      if (String(res.status)[0] !== '2') {
        throw new Error('Failed to load phrases');
      }
      const resource = await res.json();
      if (!isRecord(resource)) {
        throw new Error('Invalid format');
      }
      resolve(resource);
    } catch (err) {
      delete phrases[id];
      if (err instanceof Error && err.name === 'AbortError') {
        reject(err);
      } else {
        reject(
          new Error(
            `Failed to load phrases of namespace ${namespace} in ${locale}. Reason: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      }
    }
  });

  return phrases[id]!;
}
