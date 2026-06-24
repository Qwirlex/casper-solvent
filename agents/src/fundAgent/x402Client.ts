// Injected fetch defaults to the platform fetch. In a later task this default is
// swapped for the real x402 paying fetch that signs and retries with PAYMENT-SIGNATURE.
export async function payAndGet<T = any>(url: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`paid fetch failed ${res.status} for ${url}`);
  return (await res.json()) as T;
}
