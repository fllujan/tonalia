// Set builder RPC (SPEC 2.17): generate, score an order, alternatives for one position.
import { request } from "../../lib/rpc";
import type {
  BuilderAlternativesParams,
  BuilderGenerateParams,
  BuilderScoreParams,
} from "../../lib/rpc.types";

export const builderApi = {
  generate: (p: BuilderGenerateParams) => request("builder.generate", p),
  score: (p: BuilderScoreParams) => request("builder.score", p),
  alternatives: async (p: BuilderAlternativesParams) =>
    (await request("builder.alternatives", p)).items,
};
