import type { DeskSnapshot, Monitor } from '@desk-control/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeskMap } from './components/DeskMap.js';
import { Header } from './components/Header.js';
import { MonitorEditorSheet } from './components/MonitorEditorSheet.js';
import { PeripheralPanel } from './components/PeripheralPanel.js';
import { PresetEditorSheet } from './components/PresetEditorSheet.js';
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
  const [editing, setEditing] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () => subscribeToDesk({ onSnapshot: setSnapshot, onConnectionChange: setConnection }),
    [],
  );

  const editingPreset = useMemo(() => {
    if (!snapshot || !editingPresetId) return null;
    return snapshot.presets.find((preset) => preset.id === editingPresetId) ?? null;
  }, [snapshot, editingPresetId]);

  const selectedMonitor = useMemo<Monitor | null>(() => {
    if (!snapshot || !selectedMonitorId) return null;
    return snapshot.monitors.find((monitor) => monitor.id === selectedMonitorId) ?? null;
  }, [snapshot, selectedMonitorId]);

  // Every action is a request to the controller. Nothing here mutates desk
  // state locally - the next snapshot is the only source of truth.
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, []);

  /**
   * Saving a preset can partly succeed: a display that cannot be read is left
   * out rather than guessed, and the user is told which.
   */
  const savePreset = useCallback(
    async (action: () => Promise<{ skipped: Array<{ targetId: string; reason: string }> }>) => {
      setError(null);
      setNotice(null);
      try {
        const result = await action();
        if (result.skipped.length > 0) {
          setNotice(
            `Saved, but ${result.skipped.length} display${
              result.skipped.length === 1 ? '' : 's'
            } could not be read and were left out.`,
          );
        }
      } catch (caught) {
        setError((caught as Error).message);
      }
    },
    [],
  );

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
        header={
          <Header
            name={snapshot.controller.name}
            onOpenSystem={() => setSystemOpen(true)}
            editing={editing}
            onToggleEdit={() => {
              setEditing((current) => !current);
              setSelectedMonitorId(null);
              setEditingPresetId(null);
            }}
          />
        }
        left={
          <PresetRail
            snapshot={snapshot}
            editing={editing}
            onApply={(id) => void run(() => deskApi.applyPreset(id))}
            onEdit={(preset) => setEditingPresetId(preset.id)}
            onCreate={(name) => void savePreset(() => deskApi.createPreset(name))}
          />
        }
        stage={
          <>
            {error ? <Notice>{error}</Notice> : null}
            {notice ? <Notice tone="warn">{notice}</Notice> : null}
            <DeskMap
              snapshot={snapshot}
              editing={editing}
              onSelectMonitor={(monitor) => setSelectedMonitorId(monitor.id)}
              onMoveMonitor={(monitorId, placement) =>
                void run(() => deskApi.setPlacement(monitorId, placement))
              }
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
            <QuickActions
              snapshot={snapshot}
              onSetAllDisplaysPower={(powerState) =>
                void run(() => deskApi.setAllDisplaysPower(powerState))
              }
            />
          </>
        }
        footer={<StatusFooter snapshot={snapshot} connection={connection} />}
      />

      {selectedMonitor && !editing ? (
        <SourcePicker
          snapshot={snapshot}
          monitor={selectedMonitor}
          onPick={pickSource}
          onSetBrightness={(brightness) =>
            void run(() => deskApi.setBrightness(selectedMonitor.id, brightness))
          }
          onSetPower={(powerState) =>
            void run(() => deskApi.setMonitorPower(selectedMonitor.id, powerState))
          }
          onClose={() => setSelectedMonitorId(null)}
        />
      ) : null}

      {selectedMonitor && editing ? (
        <MonitorEditorSheet
          snapshot={snapshot}
          monitor={selectedMonitor}
          onClose={() => setSelectedMonitorId(null)}
          onRename={(customName) => void run(() => deskApi.rename(selectedMonitor.id, customName))}
          onSetWiring={(inputId, computerId) =>
            void run(() => deskApi.setWiring(selectedMonitor.id, inputId, computerId))
          }
          onDeclareComputer={(computerName, platform, inputId) =>
            void run(async () => {
              const created = await deskApi.declareComputer(computerName, platform);
              await deskApi.setWiring(selectedMonitor.id, inputId, created.computerId);
            })
          }
        />
      ) : null}

      {editingPreset ? (
        <PresetEditorSheet
          snapshot={snapshot}
          preset={editingPreset}
          onClose={() => setEditingPresetId(null)}
          onRename={(customName) => void run(() => deskApi.rename(editingPreset.id, customName))}
          onCaptureCurrent={() => {
            setEditingPresetId(null);
            void savePreset(() => deskApi.updatePresetToCurrent(editingPreset.id));
          }}
          onDelete={() => {
            setEditingPresetId(null);
            void run(() => deskApi.deletePreset(editingPreset.id));
          }}
        />
      ) : null}

      {systemOpen ? (
        <SystemSheet
          snapshot={snapshot}
          onClose={() => setSystemOpen(false)}
          onRenameComputer={(computerId, customName) =>
            void run(() => deskApi.rename(computerId, customName))
          }
          onSetAppearance={(computerId, patch) =>
            void run(() => deskApi.setOverride(computerId, patch))
          }
        />
      ) : null}
    </>
  );
}
