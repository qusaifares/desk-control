import type { DeskSnapshot, Monitor } from '@desk-control/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeskMap } from './components/DeskMap.js';
import { PeripheralBar } from './components/PeripheralBar.js';
import { PresetBar } from './components/PresetBar.js';
import { SourcePicker } from './components/SourcePicker.js';
import { SystemBar } from './components/SystemBar.js';
import { deskApi, subscribeToDesk, type ConnectionState } from './lib/api.js';

export function App() {
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToDesk({
        onSnapshot: setSnapshot,
        onConnectionChange: setConnection,
      }),
    [],
  );

  const selectedMonitor = useMemo<Monitor | null>(() => {
    if (!snapshot || !selectedMonitorId) return null;
    return snapshot.monitors.find((monitor) => monitor.id === selectedMonitorId) ?? null;
  }, [snapshot, selectedMonitorId]);

  // Every action is a request to the controller. Nothing here mutates desk
  // state locally - the next snapshot is the only source of truth.
  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, []);

  const pickSource = useCallback(
    (computerId: string) => {
      if (!selectedMonitorId) return;
      const monitorId = selectedMonitorId;
      setSelectedMonitorId(null);
      void run(() => deskApi.setMonitorSource(monitorId, computerId));
    },
    [run, selectedMonitorId],
  );

  if (!snapshot) {
    return (
      <main className="app app-loading">
        <SystemBar snapshot={null} connection={connection} />
        <p className="loading-note">
          {connection === 'connected'
            ? 'Waiting for the first desk snapshot…'
            : 'Connecting to the desk controller…'}
        </p>
      </main>
    );
  }

  return (
    <main className="app">
      <SystemBar snapshot={snapshot} connection={connection} />

      {error ? (
        <p className="app-error" role="alert">
          {error}
        </p>
      ) : null}

      <DeskMap
        snapshot={snapshot}
        onSelectMonitor={(monitor) => setSelectedMonitorId(monitor.id)}
      />

      <div className="control-columns">
        <PresetBar
          snapshot={snapshot}
          onApply={(presetId) => void run(() => deskApi.applyPreset(presetId))}
        />
        <PeripheralBar
          snapshot={snapshot}
          onSetOwner={(peripheralId, computerId) =>
            void run(() => deskApi.setPeripheralOwner(peripheralId, computerId))
          }
        />
      </div>

      {selectedMonitor ? (
        <SourcePicker
          snapshot={snapshot}
          monitor={selectedMonitor}
          onPick={pickSource}
          onClose={() => setSelectedMonitorId(null)}
          error={null}
        />
      ) : null}
    </main>
  );
}
