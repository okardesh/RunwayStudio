import { useCallback } from 'react';
import MaestroQueues from '../../../server/maestro_ui/MaestroQueues';
import { useAssetsStore } from '../../store/assetsStore';
import { queuesRequest } from '../../engine/queuesClient';
import './TransactionHistory.css';
import { queueTemplate } from '../../shared/queueTemplates';
import { useState } from 'react';
export function QueuesPanel() {
  const { connection, catalog, selectedProfileId, select } = useAssetsStore();
  const [templateQueue, setTemplateQueue] = useState('');
  const download = (kind: 'dispatcher' | 'performer') => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(queueTemplate(templateQueue, kind), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `Queue_${kind}_sample.rpa.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const request = useCallback(async (route: string, body?: unknown, session?: string) => {
    if (!connection) throw Error('Connect Studio to Maestro before using queues.');
    return queuesRequest(connection, route.replace('/api/v1/studio-queues', ''), body, session);
  }, [connection]);
  if (!connection) return <div className="bp-empty">Connect Studio to Maestro to manage queues.</div>;
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}><div className="queue-templates"><input aria-label="Template queue name" placeholder="Queue name for template" value={templateQueue} onChange={e => setTemplateQueue(e.target.value)} /><button disabled={!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(templateQueue)} onClick={() => download('dispatcher')}>Download Dispatcher sample</button><button disabled={!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(templateQueue)} onClick={() => download('performer')}>Download Performer sample</button><small>Samples download as new files. Replace sample processing before using real work.</small></div><div style={{ flex: 1, minHeight: 0 }}><MaestroQueues request={request} profiles={catalog.profiles} profileId={selectedProfileId} onSelect={select} /></div></div>;
}
