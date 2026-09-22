/** Reads a `data: {...}\n\n` event stream, calling `onEvent` per frame. */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: any) => void,
): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
      const frame = buf.slice(0, i);
      if (frame.startsWith('data: ')) onEvent(JSON.parse(frame.slice(6)));
    }
  }
}

/** POSTs JSON and streams the SSE response. Throws the API's `detail` on a non-2xx. */
export async function postStream(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (ev: any) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as any);
    throw new Error(data.detail || res.statusText);
  }
  await readSSE(res.body!, onEvent);
}
