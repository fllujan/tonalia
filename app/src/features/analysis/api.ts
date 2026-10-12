import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import { libraryKeys } from "../library/api";

/**
 * Key and energy distribution of the analysed tracks. Under the library key, so the
 * table's refresh after each analysed track (useLibraryEvents) refreshes it too.
 */
export function useLibraryStats() {
  return useQuery({
    queryKey: [...libraryKeys.all, "stats"],
    queryFn: () => request("library.stats"),
  });
}
