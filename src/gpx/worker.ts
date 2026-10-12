/**
 * Web Worker entry for parsing: receives a {@link ParseRequest}, answers with a
 * {@link ParseResponse}, transferring the point arrays rather than copying them. All the work is in
 * `handler.ts`; this file only wires it to the worker's message port. Started by `client.ts`.
 */

import { handleMessage, type ParseRequest } from './handler';

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  const { response, transfer } = handleMessage(event.data);
  self.postMessage(response, { transfer });
});
