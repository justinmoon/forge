import { TextEncoder } from "node:util";

export interface JobEventPayload {
	id: number;
	repo: string;
	branch: string;
	headCommit: string;
	status: string;
	exitCode: number | null;
	startedAt: string;
	finishedAt: string | null;
}

const encoder = new TextEncoder();
const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
const activeJobs = new Map<number, JobEventPayload>();

function isActive(status: string): boolean {
	return status === "running" || status === "pending";
}

function encodeEvent(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcastJobEvent(payload: JobEventPayload): void {
	if (isActive(payload.status)) {
		activeJobs.set(payload.id, payload);
	} else {
		activeJobs.delete(payload.id);
	}

	const frame = encodeEvent("job", payload);
	for (const controller of subscribers) {
		try {
			controller.enqueue(frame);
		} catch (error) {
			console.error("Failed to deliver job event:", error);
		}
	}
}

export function createJobEventStream(initialJobs: JobEventPayload[]): Response {
	// Seed active job state for this connection; we only track active jobs here.
	activeJobs.clear();
	for (const job of initialJobs) {
		if (isActive(job.status)) {
			activeJobs.set(job.id, job);
		}
	}

	let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controllerRef = controller;
			subscribers.add(controller);

			const snapshot = Array.from(activeJobs.values());
			controller.enqueue(encodeEvent("snapshot", { jobs: snapshot }));
		},
		cancel() {
			if (controllerRef) {
				subscribers.delete(controllerRef);
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Content-Type": "text/event-stream",
		},
	});
}
