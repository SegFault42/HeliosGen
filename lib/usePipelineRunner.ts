import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkflowStore } from "./store";
import { buildPipelineWaves } from "./executor";
import { decideWave } from "./pipelineWait";

interface PipelineState {
  waves: string[][];
  waveIdx: number;
  waveStarted: boolean;
}

export function usePipelineRunner(scopeNodeIds?: string[]) {
  const nodes = useWorkflowStore(s => s.nodes);
  const updateNodeData = useWorkflowStore(s => s.updateNodeData);

  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const waveEverActive = useRef(false);
  const scopeRef = useRef(scopeNodeIds);
  useEffect(() => { scopeRef.current = scopeNodeIds; });

  const isRunning = pipeline !== null;

  const scopedNodes = scopeNodeIds
    ? nodes.filter(n => scopeNodeIds.includes(n.id))
    : nodes;

  const genNodeCount = scopedNodes.filter(
    n => n.type === "generateNode" || n.type === "videoGeneratorNode"
  ).length;

  const run = useCallback(() => {
    const { nodes, edges } = useWorkflowStore.getState();
    const scope = scopeRef.current;
    const filteredNodes = scope ? nodes.filter(n => scope.includes(n.id)) : nodes;
    const waves = buildPipelineWaves(filteredNodes, edges);
    if (waves.length === 0) return;

    // Mark future-wave nodes as queued so they show a waiting indicator
    for (let i = 1; i < waves.length; i++) {
      for (const id of waves[i]) {
        updateNodeData(id, { pipelineQueued: true });
      }
    }

    waveEverActive.current = false;
    setPipeline({ waves, waveIdx: 0, waveStarted: false });
  }, [updateNodeData]);

  // Clear any leftover queued flags when the pipeline ends (e.g. early error)
  useEffect(() => {
    if (pipeline !== null) return;
    const { nodes } = useWorkflowStore.getState();
    const scope = scopeRef.current;
    const scoped = scope ? nodes.filter(n => scope.includes(n.id)) : nodes;
    for (const node of scoped) {
      if (node.data.pipelineQueued) updateNodeData(node.id, { pipelineQueued: false });
    }
  }, [pipeline, updateNodeData]);

  useEffect(() => {
    if (!pipeline) return;
    const { waves, waveIdx, waveStarted } = pipeline;
    const currentWave = waves[waveIdx];

    // Trigger the wave
    if (!waveStarted) {
      waveEverActive.current = false;
      for (const id of currentWave) {
        updateNodeData(id, { pendingGenerate: true });
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- advances the wave state machine from node status in the store
      setPipeline(p => p ? { ...p, waveStarted: true } : null);
      return;
    }

    // Only mark the wave as "ever active" once a node actually reaches
    // status "pending" or "running", NOT merely on pendingGenerate being set.
    // This prevents a race where pendingGenerate is cleared before generate()
    // sets status:"pending", causing the runner to think the wave is already done.
    const states = currentWave.map(id => nodes.find(n => n.id === id)?.data);
    if (states.some(d => d?.status === "pending" || d?.status === "running")) waveEverActive.current = true;

    const decision = decideWave(states, waveEverActive.current, waveIdx + 1 < waves.length);
    if (decision === "wait") return;
    if (decision === "stop") {
      // A node failed: end the pipeline (queued flags are cleared by the effect above).
      setPipeline(null);
      return;
    }

    // Advance to next wave or finish
    const nextIdx = waveIdx + 1;
    if (nextIdx >= waves.length) {
      setPipeline(null);
    } else {
      waveEverActive.current = false;
      for (const id of waves[nextIdx]) {
        updateNodeData(id, { pendingGenerate: true, pipelineQueued: false });
      }
      setPipeline({ waves, waveIdx: nextIdx, waveStarted: true });
    }
  }, [nodes, pipeline, updateNodeData]);

  return { run, isRunning, genNodeCount };
}
