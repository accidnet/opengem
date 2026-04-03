import modelsCatalog from "@/config/models.json";

type ModelsDevModel = {
  id?: string;
  name?: string;
};

type ModelsDevProvider = {
  id?: string;
  name?: string;
  models?: Record<string, ModelsDevModel>;
};

export type ModelsDevResponse = Record<string, ModelsDevProvider>;

export function getModelsDevCatalog(): ModelsDevResponse {
  return modelsCatalog as ModelsDevResponse;
}
