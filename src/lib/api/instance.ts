import { instanceStateSchema, type InstanceState } from "@/lib/schemas/instance";
import {
  instanceSettingsSchema,
  type InstanceSettings,
} from "@/lib/schemas/instance-settings";
import type { CredentialsInput } from "@/lib/schemas/credentials";

async function parseResponse<T>(
  response: Response,
  parse: (data: unknown) => T,
): Promise<T> {
  const data: unknown = await response.json();
  if (!response.ok) {
    throw data;
  }
  return parse(data);
}

export async function fetchInstanceState(): Promise<InstanceState> {
  const response = await fetch("/api/instance");
  return parseResponse(response, (data) => instanceStateSchema.parse(data));
}

export async function submitSetup(input: CredentialsInput): Promise<void> {
  const response = await fetch("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  await parseResponse(response, () => undefined);
}

export async function submitRegistration(input: CredentialsInput): Promise<void> {
  const response = await fetch("/api/registration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  await parseResponse(response, () => undefined);
}

export async function updateInstanceSettings(
  input: InstanceSettings,
): Promise<InstanceSettings> {
  const response = await fetch("/api/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response, (data) => instanceSettingsSchema.parse(data));
}
