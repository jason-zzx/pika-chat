import { parseJson } from "@/lib/api/parse";
import { demoUsageResponseSchema, type DemoUsageResponse } from "@/lib/schemas/demo";

export async function fetchDemoUsage(): Promise<DemoUsageResponse> {
  const response = await fetch("/api/demo/usage");
  return parseJson(response, (data) => demoUsageResponseSchema.parse(data));
}
