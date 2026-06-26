// pi-webveil — a pi extension exposing web_search and web_fetch tools backed by
// webveil's core. A drop-in, anonymity-capable replacement for Ollama's
// web_search/web_fetch (same tool names), calling webveil IN-PROCESS (no shelling).
//
// Placeholder surface. The real implementation (built by tasks from the PRD) registers
// two tools that call webveil's exported search()/fetch() functions, formats results
// for the LLM, and resolves per-folder config (.pi/webveil.json) from ctx.cwd.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function piWebveil(_pi: any): void {
	// pi.registerTool({ name: 'web_search', ... execute -> webveil.search(...) })
	// pi.registerTool({ name: 'web_fetch',  ... execute -> webveil.fetch(...) })
	throw new Error(
		'pi-webveil: extension not implemented yet (see work/prds/ready)',
	);
}
