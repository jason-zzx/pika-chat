import { parseJson } from "@/lib/api/parse";
import {
  searchResponseSchema,
  type SearchResponse,
} from "@/lib/schemas/search";

export async function searchTopicsAndMessages(
  query: string,
): Promise<SearchResponse> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  return parseJson(response, (data) => searchResponseSchema.parse(data));
}
