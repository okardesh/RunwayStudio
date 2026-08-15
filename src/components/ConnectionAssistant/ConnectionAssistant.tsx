import { useEffect, useRef, useState } from 'react';
import { connectToRunwayServer, getSavedServerUrl, type RunwayConnection } from '../../engine/runwayConnection';
import './ConnectionAssistant.css';

interface ConnectionAssistantProps {
  onConnected: (connection: RunwayConnection) => void;
}

export function ConnectionAssistant({ onConnected }: ConnectionAssistantProps) {
  const [serverUrl, setServerUrl] = useState(getSavedServerUrl());
  const [error, setError] = useState('');
  const [isConnecting, setConnecting] = useState(false);
  const hasStartedInitialConnection = useRef(false);

  useEffect(() => {
    if (serverUrl && !hasStartedInitialConnection.current) {
      hasStartedInitialConnection.current = true;
      void handleConnect();
    }
    // A saved URL is intentionally checked once at startup so an expired lease cannot unlock Studio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setError('');
    try {
      const connection = await connectToRunwayServer(serverUrl);
      onConnected(connection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect to Runway server.');
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main className="connection-assistant">
      <section className="connection-assistant__panel">
        <div className="connection-assistant__mark">R</div>
        <p className="connection-assistant__eyebrow">RUNWAY STUDIO</p>
        <h1>Connect to Runway</h1>
        <p className="connection-assistant__intro">Connect to your Runway server to activate Studio and publish workflows.</p>

        <label className="connection-assistant__field">
          <span>Runway server URL</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="http://localhost:5050"
            type="url"
            autoFocus={!serverUrl}
            onKeyDown={(event) => { if (event.key === 'Enter') void handleConnect(); }}
            disabled={isConnecting}
          />
        </label>

        {error && <div className="connection-assistant__error" role="alert">{error}</div>}

        <button className="connection-assistant__connect" type="button" onClick={() => void handleConnect()} disabled={isConnecting || !serverUrl.trim()}>
          {isConnecting ? 'Checking server and license...' : 'Connect and activate Studio'}
        </button>

        <div className="connection-assistant__note">
          <strong>License required</strong>
          <span>Runway will verify Developer Studio access and consume one available license before continuing.</span>
        </div>
      </section>
    </main>
  );
}