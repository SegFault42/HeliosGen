// Creates an isolated five-provider smoke canvas. Never modifies existing canvases.
const base = 'http://127.0.0.1:3000';
const id = 'free-provider-smoke-20260928';
const node = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data });
const pairs = [
  ['gpt', 'generateNode', 'gpt-image-2', 'A small red paper kite on a clear blue sky, clean photographic composition, no people, no text.'],
  ['nano', 'generateNode', 'flow-nano-banana-2', 'A single turquoise ceramic cup on white paper, studio light, no people, no text.'],
  ['grok', 'generateNode', 'grok-imagine', 'A single orange origami bird on a pale gray background, studio light, no people, no text.'],
  ['omni', 'videoGeneratorNode', 'flow-omni-flash', 'A paper boat floats slowly along a shallow stream, gentle moving ripples, fixed camera, no people, no text.'],
  ['heygen', 'videoGeneratorNode', 'heygen-video-agent', 'A short vertical video: a cheerful abstract paper mascot says in Brazilian Portuguese, "Teste de vídeo." Single shot, no music, no text.'],
];
const nodes = [], edges = [];
for (const [key, type, model, prompt] of pairs) {
  nodes.push(node(`prompt-${key}`, 'promptNode', { label: `Smoke prompt ${key}`, prompt }));
  nodes.push(node(`output-${key}`, type, { label: `Smoke ${key}`, ...(type === 'generateNode' ? { model, aspectRatio: '9:16', quality: '1k' } : { videoModel: model, aspectRatio: '9:16', duration: 5 }) }));
  edges.push({ id: `edge-${key}`, source: `prompt-${key}`, target: `output-${key}`, targetHandle: 'prompt' });
}
const space = { id, name: 'Smoke FREE providers 2026-09-28', nodes, edges, nodeCounters: {}, createdAt: Date.now() };
const res = await fetch(`${base}/api/workflows`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spaces: [space], partial: true }) });
const data = await res.json();
if (!res.ok || !data.ok) throw new Error(`save ${res.status}: ${JSON.stringify(data)}`);
const read = await (await fetch(`${base}/api/workflows`)).json();
const saved = read.spaces.find(s => s.id === id);
if (!saved || saved.nodes.length !== nodes.length || saved.edges.length !== edges.length) throw new Error('read-back mismatch');
console.log(JSON.stringify({ id, name: saved.name, nodes: saved.nodes.length, edges: saved.edges.length, outputs: pairs.map(p => `output-${p[0]}`) }));
