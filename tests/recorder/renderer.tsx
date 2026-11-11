import { WorkflowRecorderModal } from '../../src/components/Recorder/WorkflowRecorderModal';
import { buildRecordedWorkflow } from '../../src/components/Recorder/workflowRecording';
import { executeWorkflow } from '../../src/engine/executor';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RecorderModal } from '../../src/components/Recorder/RecorderModal';
import { DesktopPickerModal } from '../../src/components/Recorder/DesktopPickerModal';

const root = createRoot(document.getElementById('root')!);
const test = window as any;
test.selections = [];
test.closeCount = 0;
test.mountRecorder = () => root.render(<React.StrictMode><RecorderModal
  onSelect={selector => test.selections.push(selector)} onClose={() => test.closeCount++}
/></React.StrictMode>);
test.mountDesktop = () => root.render(<React.StrictMode><DesktopPickerModal windowTitle="Recorder Fixture"
  onSelect={selector => test.selections.push(selector)} onClose={() => test.closeCount++}
/></React.StrictMode>);
test.unmountRecorder = () => root.render(null);

test.mountSession = () => root.render(<React.StrictMode><WorkflowRecorderModal onClose={() => root.render(null)} onSave={async (steps, logOutputs) => { test.recordedSteps = steps; test.recordedWorkflow = buildRecordedWorkflow(steps, [], logOutputs); root.render(<div data-testid="saved">Saved</div>); }} /></React.StrictMode>);
test.replayRecording = async () => { test.replayLogs=[]; return executeWorkflow(test.recordedWorkflow.nodes, [], test.recordedWorkflow.variables, () => {}, () => {}, (text,level) => test.replayLogs.push({text,level})); };
