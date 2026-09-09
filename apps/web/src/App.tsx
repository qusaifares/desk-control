import type { DeskSnapshot, Monitor } from '@desk-control/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeskMap } from './components/DeskMap.js';
import { Header } from './components/Header.js';
import { PeripheralPanel } from './components/PeripheralPanel.js';
import { PresetRail } from './components/PresetRail.js';
import { QuickActions } from './components/QuickActions.js';
import { SourcePicker } from './components/SourcePicker.js';
import { StatusFooter } from './components/StatusFooter.js';
import { SystemSheet } from './components/SystemSheet.js';
import { AppShell, Notice } from './design/index.js';
import { deskApi, subscribeToDesk, type ConnectionState } from './lib/api.js';

export function App() {
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [systemOpen, setSystemOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => subscribeToDesk({ onSnapshot: setSnapshot, onConnectionChange: setConnection }),
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
      <AppShell
        header={<Header name="Desk" onOpenSystem={() => {}} />}
        stage={
          <div className="desk-loading">
            {connection === 'connected'
              ? 'Waiting for the first desk snapshot…'
              : 'Connecting to the desk controller…'}
          </div>
        }
      />
    );
  }

  return (
    <>
      <AppShell
        header={<Header name={snapshot.controller.name} onOpenSystem={() => setSystemOpen(true)} />}
        left={
          <PresetRail
            snapshot={snapshot}
            onApply={(id) => void run(() => deskApi.applyPreset(id))}
          />
        }
        stage={
          <>
            {error ? <Notice>{error}</Notice> : null}
            <DeskMap
              snapshot={snapshot}
              onSelectMonitor={(monitor) => setSelectedMonitorId(monitor.id)}
            />
          </>
        }
        right={
          <>
            <PeripheralPanel
              snapshot={snapshot}
              onSetOwner={(peripheralId, computerId) =>
                void run(() => deskApi.setPeripheralOwner(peripheralId, computerId))
              }
            />
            <QuickActions snapshot={snapshot} />
          </>
        }
        footer={<StatusFooter snapshot={snapshot} connection={connection} />}
      />

      {selectedMonitor ? (
        <SourcePicker
          snapshot={snapshot}
          monitor={selectedMonitor}
          onPick={pickSource}
          onClose={() => setSelectedMonitorId(null)}
        />
      ) : null}

      {systemOpen ? <SystemSheet snapshot={snapshot} onClose={() => setSystemOpen(false)} /> : null}
    </>
  );
}
