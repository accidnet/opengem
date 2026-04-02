const DEFAULT_MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 5 * 60 * 1000;

type ModelsDevModel = {
  id?: string;
  name?: string;
};

type ModelsDevProvider = {
  id?: string;
  name?: string;
  models?: Record<string, ModelsDevModel>;
};

type ModelsDevResponse = Record<string, ModelsDevProvider>;

type CachedCatalog = {
  fetchedAt: number;
  payload: ModelsDevResponse;
};

let cachedCatalog: CachedCatalog | undefined;
let inflightCatalogRequest: Promise<ModelsDevResponse> | undefined;

function resolveModelsDevUrl() {
  return (import.meta.env.VITE_MODELS_DEV_URL as string | undefined)?.trim() || DEFAULT_MODELS_DEV_URL;
}

export async function fetchModelsDevCatalog(force = false): Promise<ModelsDevResponse> {
  const now = Date.now();
  if (!force && cachedCatalog && now - cachedCatalog.fetchedAt < CACHE_TTL_MS) {
    return cachedCatalog.payload;
  }

  if (!force && inflightCatalogRequest) {
    return inflightCatalogRequest;
  }

  inflightCatalogRequest = fetch(resolveModelsDevUrl(), {
    headers: {
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`models.dev request failed with ${response.status}`);
      }

      const payload = (await response.json()) as ModelsDevResponse;
      cachedCatalog = {
        fetchedAt: Date.now(),
        payload,
      };
      return payload;
    })
    .finally(() => {
      inflightCatalogRequest = undefined;
    });

  return inflightCatalogRequest;
}

export function clearModelsDevCatalogCache() {
  cachedCatalog = undefined;
}
