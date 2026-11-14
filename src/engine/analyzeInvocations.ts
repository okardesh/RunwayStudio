import { hasWorkflowCall, loadWorkflowGraph, type WorkflowLoader } from '../shared/invokedWorkflows';
import { analyzeWorkflow, type AnalysisSource, type AnalysisFinding } from './workflowAnalyzer';
import { loadInvokedWorkflow } from './workflowLoader';

export async function analyzeInvocations(source: AnalysisSource, loader: WorkflowLoader = loadInvokedWorkflow): Promise<AnalysisFinding[]> {
  const findings: AnalysisFinding[] = [];
  for (const node of source.nodes.filter(hasWorkflowCall)) {
    try {
      const graph = await loadWorkflowGraph({ ...source, nodes: [node] }, source.filePath, loader);
      for (const file of graph.files) {
        const child = analyzeWorkflow({ ...file.definition, assets: source.assets, filePath: file.path, targets: [...source.targets, ...(file.definition.uiTargets ?? []).filter((t) => !source.targets.some((current) => current.id === t.id))] });
        for (const finding of child.findings.filter((f) => f.code !== 'WA300')) findings.push({ ...finding, id: `invoke:${node.id}:${findings.length}`, nodeId: node.id, activity: node.data.label,
          property: `Called: ${file.definition.projectName} / ${finding.activity} / ${finding.property}`, recommendation: `In ${file.path}: ${finding.recommendation}` });
      }
    } catch (error) { findings.push({ id: `invoke:${node.id}:${findings.length}`, code: 'WA301', severity: 'error', nodeId: node.id, activity: node.data.label, property: 'Workflow File / Arguments', message: error instanceof Error ? error.message : 'Workflow dependency could not be checked.', recommendation: 'Check the .rpa.json path, required In mappings, Out destinations and recursive calls. No activities were executed.' }); }
  }
  return findings.slice(0, 500);
}
