export async function parseJson<T>(
  response: Response,
  parse: (data: unknown) => T,
): Promise<T> {
  const data: unknown = await response.json();
  if (!response.ok) {
    throw data;
  }
  return parse(data);
}

export async function parseEmpty(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const data: unknown = await response.json();
  throw data;
}
