import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionAssistant } from '../../src/components/ConnectionAssistant/ConnectionAssistant';
import { heartbeatRunwayLicense, releaseRunwayLicense } from '../../src/engine/runwayConnection';

const parameters = new URLSearchParams(location.search);
const serverUrl = parameters.get('server')!;
localStorage.clear();
localStorage.setItem('runway.studio.serverUrl', serverUrl);
const fixture = window as any;
fixture.connectionOutcome = null;
fixture.heartbeat = () => heartbeatRunwayLicense(fixture.connectionOutcome);
fixture.release = () => releaseRunwayLicense(fixture.connectionOutcome);
fixture.mountConnection = () => createRoot(document.getElementById('root')!).render(
  <ConnectionAssistant onConnected={connection => { fixture.connectionOutcome = connection; document.getElementById('root')!.textContent = 'Fixture Studio connected'; }} />,
);
