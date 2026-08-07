import type { NodeTypes } from 'reactflow';
import ActivityNode from './ActivityNode';
import StartNode from './StartNode';
import EndNode from './EndNode';
import DecisionNode from './DecisionNode';
import SequenceNode from './SequenceNode';

export const nodeTypes: NodeTypes = {
  activityNode: ActivityNode,
  startNode: StartNode,
  endNode: EndNode,
  decisionNode: DecisionNode,
  sequenceNode: SequenceNode,
};
