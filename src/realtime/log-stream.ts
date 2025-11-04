import { existsSync, readFileSync } from "node:fs";
import { TextEncoder } from "node:util";
import AnsiToHtml from "ansi-to-html";

const encoder = new TextEncoder();

const converter = new AnsiToHtml({
	fg: "#d4d4d4",
	bg: "#1e1e1e",
	newline: true,
	escapeXML: true,
});

const logHtmlCache = new Map<number, string>();
const subscribers = new Map<
	number,
	Set<ReadableStreamDefaultController<Uint8Array>>
>();

const ZERO_WIDTH_SPACE = "&#8203;";

function toHtml(text: string): string {
	if (!text) return "";
	return converter.toHtml(text);
}

function safeHtml(html: string): string {
	return html === "" ? ZERO_WIDTH_SPACE : html;
}

function encodeEvent(event: string, data: string): Uint8Array {
	const payload = `event: ${event}\ndata: ${data}\n\n`;
	return encoder.encode(payload);
}

function addSubscriber(
	jobId: number,
	controller: ReadableStreamDefaultController<Uint8Array>,
): void {
	const listeners = subscribers.get(jobId);
	if (listeners) {
		listeners.add(controller);
		return;
	}
	subscribers.set(jobId, new Set([controller]));
}

function removeSubscriber(
	jobId: number,
	controller: ReadableStreamDefaultController<Uint8Array> | null,
): void {
	if (!controller) return;
	const listeners = subscribers.get(jobId);
	if (!listeners) return;
	listeners.delete(controller);
	if (listeners.size === 0) {
		subscribers.delete(jobId);
	}
}

function broadcast(jobId: number, html: string): void {
	const listeners = subscribers.get(jobId);
	if (!listeners) return;
	const payload = encodeEvent("log", JSON.stringify({ html: safeHtml(html) }));
	for (const controller of listeners) {
		controller.enqueue(payload);
	}
}

export function seedJobLog(jobId: number, logText: string): string {
	const html = toHtml(logText);
	logHtmlCache.set(jobId, html);
	broadcast(jobId, html);
	return html;
}

export function ensureJobLog(jobId: number, logPath: string): string {
	const existing = logHtmlCache.get(jobId);
	if (existing !== undefined) {
		return existing;
	}

	if (!existsSync(logPath)) {
		logHtmlCache.set(jobId, "");
		return "";
	}

	const raw = readFileSync(logPath, "utf-8");
	return seedJobLog(jobId, raw);
}

export function appendJobLogChunk(
	jobId: number,
	chunk: string | Uint8Array,
): void {
	const text = typeof chunk === "string" ? chunk : chunk.toString();
	if (!text) return;

	const htmlChunk = toHtml(text);
	const updated = (logHtmlCache.get(jobId) ?? "") + htmlChunk;
	logHtmlCache.set(jobId, updated);
	broadcast(jobId, updated);
}

export function completeJobLog(jobId: number): void {
	const html = logHtmlCache.get(jobId) ?? "";
	broadcast(jobId, html);
	subscribers.delete(jobId);
}

export function streamJobLog(jobId: number): Response {
	let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controllerRef = controller;
			addSubscriber(jobId, controller);

			const current = logHtmlCache.get(jobId);
			const initialHtml = safeHtml(current ?? "");
			controller.enqueue(
				encodeEvent("log", JSON.stringify({ html: initialHtml })),
			);
		},
		cancel() {
			removeSubscriber(jobId, controllerRef);
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
