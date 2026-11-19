import { isServerContainerRequest, type Request, type Response } from '@tagreeve/core';

export interface ServerContainerRejected {
  pass: boolean;
  evidence: string[];
  message: string;
}

const NO_ANSWER = 'no answer';
const COUNTS = /^(\d+) of (\d+) requests to the server container were rejected/;

export function rejectedCounts(message: string | undefined): { rejected: number; counted: number } | null {
  const m = COUNTS.exec(message ?? '');
  return m ? { rejected: Number(m[1]), counted: Number(m[2]) } : null;
}

/**
 * Browser requests that the local server container answered, judged by their status. A `passed` request never reached
 * the container (a service worker took it), so it is left out. The message holds counts and
 * status codes only, because a provider path can hold a loader ID.
 */
export function serverContainerRejected(
  requests: readonly Request[],
  responses: readonly Response[],
  serverHosts: readonly string[],
): ServerContainerRejected {
  const statusOf = new Map(responses.map((r) => [r.requestId, r.status]));
  const counted = requests.filter(
    (r) => !r.captured && r.outcome !== 'passed' && r.initiator !== 'unload' && r.initiator !== 'redirect' && isServerContainerRequest(r, serverHosts),
  );
  if (counted.length === 0) return { pass: true, evidence: [], message: 'No requests to the server container to check.' };
  const rejected = counted.filter((r) => {
    const status = statusOf.get(r.id);
    return status === undefined || status >= 400;
  });
  const warn = rejected.length >= 2 && rejected.length * 2 > counted.length;
  if (!warn) {
    return { pass: true, evidence: [], message: `${rejected.length} of ${counted.length} requests to the server container were rejected.` };
  }
  const byStatus = new Map<number, number>();
  let unanswered = 0;
  for (const r of rejected) {
    const status = statusOf.get(r.id);
    if (status === undefined) unanswered++;
    else byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }
  const parts = [...byStatus].sort((a, b) => a[0] - b[0]).map(([status, n]) => `${status}: ${n}`);
  if (unanswered > 0) parts.push(`${NO_ANSWER}: ${unanswered}`);
  return {
    pass: false,
    evidence: rejected.map((r) => r.id),
    message: `${rejected.length} of ${counted.length} requests to the server container were rejected (${parts.join(', ')}).`,
  };
}
