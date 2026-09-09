import type { Platform, ComputerCapability, DeskLayout, Preset } from '@desk-control/domain';
import type { SimulatedMonitorSpec, SimulatedSwitchSpec } from '@desk-control/hardware';
import type { DeskConfig } from './schema.js';

/**
 * SEED DATA ONLY.
 *
 * This describes one example desk (four ASUS monitors, four computers, a shared
 * keyboard and mouse) so the simulator and the first-run config have something
 * concrete to show. Nothing in the controller, protocol or domain depends on
 * any value in this file - delete it and the system still works, it just starts
 * empty. Do not import it from core logic.
 */

export const EXAMPLE_COMPUTER_IDS = {
  gamingPc: 'computer:gaming-pc',
  m4MacBook: 'computer:m4-macbook',
  m2MacBook: 'computer:m2-macbook',
  surface: 'computer:surface',
} as const;

export const EXAMPLE_MONITOR_IDS = {
  topLandscape: 'monitor:aus:xg27aqm:asus-xg27-0001',
  bottomLandscape: 'monitor:aus:xg27aqm:asus-xg27-0002',
  leftPortrait: 'monitor:aus:pa248qv:asus-pa24-0003',
  rightPortrait: 'monitor:aus:pa248qv:asus-pa24-0004',
} as const;

export const EXAMPLE_SWITCH_ID = 'switch:kvm-4port';
export const EXAMPLE_PERIPHERAL_IDS = {
  keyboard: 'peripheral:keyboard-main',
  mouse: 'peripheral:mouse-main',
} as const;

export interface ExampleComputer {
  id: string;
  detectedName: string;
  platform: Platform;
  capabilities: ComputerCapability[];
  metadata: Record<string, string>;
}

export const EXAMPLE_COMPUTERS: ExampleComputer[] = [
  {
    id: EXAMPLE_COMPUTER_IDS.gamingPc,
    detectedName: 'DESKTOP-GAMING',
    platform: 'windows',
    capabilities: ['ddc-control', 'wake-on-lan', 'sleep', 'report-active-display'],
    metadata: { simulated: 'true', role: 'gaming' },
  },
  {
    id: EXAMPLE_COMPUTER_IDS.m4MacBook,
    detectedName: 'MacBook-Pro-M4',
    platform: 'macos',
    capabilities: ['ddc-control', 'sleep', 'report-active-display'],
    metadata: { simulated: 'true', role: 'work' },
  },
  {
    id: EXAMPLE_COMPUTER_IDS.m2MacBook,
    // Deliberately capability-poor: it can be a video source but cannot drive
    // DDC. The UI must still let you route it to a monitor.
    detectedName: 'MacBook-Air-M2',
    platform: 'macos',
    capabilities: ['report-active-display'],
    metadata: { simulated: 'true', role: 'personal' },
  },
  {
    id: EXAMPLE_COMPUTER_IDS.surface,
    detectedName: 'SURFACE-PRO',
    platform: 'windows',
    capabilities: ['ddc-control', 'sleep'],
    metadata: { simulated: 'true', role: 'portable' },
  },
];

const dp = (computerId: string | null, label: string) => ({
  id: 'input-dp1',
  connector: 'DisplayPort' as const,
  ddcInputSourceValue: 0x0f,
  detectedName: label,
  connectedComputerId: computerId,
  maxMode: { width: 2560, height: 1440, refreshHz: 270, vrr: true, bitDepth: 10 },
});

export const EXAMPLE_MONITOR_SPECS: SimulatedMonitorSpec[] = [
  {
    stableId: EXAMPLE_MONITOR_IDS.topLandscape,
    detectedName: 'ASUS XG27AQM',
    manufacturerId: 'AUS',
    model: 'XG27AQM',
    serial: 'ASUS-XG27-0001',
    manufactureYear: 2022,
    capabilities: ['input-switch', 'brightness', 'power', 'read-active-input'],
    requiresActiveInput: true,
    switchDelayMs: 1800,
    activeInputId: 'input-dp1',
    preferredInputId: 'input-dp1',
    inputs: [
      dp(EXAMPLE_COMPUTER_IDS.gamingPc, 'DisplayPort 1'),
      {
        id: 'input-hdmi1',
        connector: 'HDMI',
        ddcInputSourceValue: 0x11,
        detectedName: 'HDMI 1',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
        maxMode: { width: 2560, height: 1440, refreshHz: 144, vrr: false, bitDepth: 8 },
      },
      {
        id: 'input-hdmi2',
        connector: 'HDMI',
        ddcInputSourceValue: 0x12,
        detectedName: 'HDMI 2',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.surface,
        maxMode: { width: 1920, height: 1080, refreshHz: 60, vrr: false, bitDepth: 8 },
      },
      {
        id: 'input-usbc',
        connector: 'USB-C',
        ddcInputSourceValue: 0x1b,
        detectedName: 'USB-C',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.m2MacBook,
        maxMode: { width: 2560, height: 1440, refreshHz: 60, vrr: false, bitDepth: 8 },
      },
    ],
  },
  {
    stableId: EXAMPLE_MONITOR_IDS.bottomLandscape,
    detectedName: 'ASUS XG27AQM',
    manufacturerId: 'AUS',
    model: 'XG27AQM',
    serial: 'ASUS-XG27-0002',
    manufactureYear: 2022,
    capabilities: ['input-switch', 'brightness', 'power', 'read-active-input'],
    requiresActiveInput: true,
    switchDelayMs: 2200,
    activeInputId: 'input-dp1',
    preferredInputId: 'input-dp1',
    inputs: [
      dp(EXAMPLE_COMPUTER_IDS.gamingPc, 'DisplayPort 1'),
      {
        id: 'input-hdmi1',
        connector: 'HDMI',
        ddcInputSourceValue: 0x11,
        detectedName: 'HDMI 1',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
        maxMode: { width: 2560, height: 1440, refreshHz: 144, vrr: false, bitDepth: 8 },
      },
      {
        id: 'input-hdmi2',
        connector: 'HDMI',
        ddcInputSourceValue: 0x12,
        detectedName: 'HDMI 2',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.surface,
        maxMode: { width: 1920, height: 1080, refreshHz: 60, vrr: false, bitDepth: 8 },
      },
    ],
  },
  {
    stableId: EXAMPLE_MONITOR_IDS.leftPortrait,
    detectedName: 'ASUS PA248QV',
    manufacturerId: 'AUS',
    model: 'PA248QV',
    serial: 'ASUS-PA24-0003',
    manufactureYear: 2021,
    // Capability-poor on purpose: input switching only, no brightness/power.
    capabilities: ['input-switch'],
    requiresActiveInput: true,
    switchDelayMs: 1200,
    activeInputId: 'input-dp1',
    preferredInputId: 'input-dp1',
    inputs: [
      {
        id: 'input-dp1',
        connector: 'DisplayPort',
        ddcInputSourceValue: 0x0f,
        detectedName: 'DisplayPort 1',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.gamingPc,
        maxMode: { width: 1920, height: 1200, refreshHz: 75, vrr: false, bitDepth: 8 },
      },
      {
        id: 'input-hdmi1',
        connector: 'HDMI',
        ddcInputSourceValue: 0x11,
        detectedName: 'HDMI 1',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
        maxMode: { width: 1920, height: 1200, refreshHz: 60, vrr: false, bitDepth: 8 },
      },
    ],
  },
  {
    stableId: EXAMPLE_MONITOR_IDS.rightPortrait,
    detectedName: 'ASUS PA248QV',
    manufacturerId: 'AUS',
    model: 'PA248QV',
    serial: 'ASUS-PA24-0004',
    manufactureYear: 2021,
    capabilities: ['input-switch', 'brightness', 'power', 'read-active-input'],
    requiresActiveInput: true,
    switchDelayMs: 1400,
    activeInputId: 'input-dp1',
    preferredInputId: 'input-dp1',
    inputs: [
      {
        id: 'input-dp1',
        connector: 'DisplayPort',
        ddcInputSourceValue: 0x0f,
        detectedName: 'DisplayPort 1',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.gamingPc,
        maxMode: { width: 1920, height: 1200, refreshHz: 75, vrr: false, bitDepth: 8 },
      },
      {
        id: 'input-hdmi1',
        connector: 'HDMI',
        ddcInputSourceValue: 0x11,
        detectedName: 'HDMI 1',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
        maxMode: { width: 1920, height: 1200, refreshHz: 60, vrr: false, bitDepth: 8 },
      },
      {
        id: 'input-usbc',
        connector: 'USB-C',
        ddcInputSourceValue: 0x1b,
        detectedName: 'USB-C',
        connectedComputerId: EXAMPLE_COMPUTER_IDS.m2MacBook,
        maxMode: { width: 1920, height: 1200, refreshHz: 60, vrr: false, bitDepth: 8 },
      },
    ],
  },
];

export const EXAMPLE_SWITCH_SPEC: SimulatedSwitchSpec = {
  switchId: EXAMPLE_SWITCH_ID,
  channels: ['default'],
  ports: ['port-1', 'port-2', 'port-3', 'port-4'],
  initialPorts: { default: 'port-1' },
  switchDelayMs: 900,
};

const EXAMPLE_LAYOUT: DeskLayout = {
  id: 'layout:default',
  name: 'Main desk',
  grid: { columns: 33, rows: 20 },
  placements: {
    // Portraits deliberately span most of the centre stack's height.
    [EXAMPLE_MONITOR_IDS.leftPortrait]: {
      x: 0,
      y: 1,
      width: 7,
      height: 17.5,
      orientation: 'portrait-left',
    },
    [EXAMPLE_MONITOR_IDS.topLandscape]: {
      x: 8,
      y: 0,
      width: 17,
      height: 9.5,
      orientation: 'landscape',
    },
    [EXAMPLE_MONITOR_IDS.bottomLandscape]: {
      x: 8,
      y: 10,
      width: 17,
      height: 9.5,
      orientation: 'landscape',
    },
    [EXAMPLE_MONITOR_IDS.rightPortrait]: {
      x: 26,
      y: 1,
      width: 7,
      height: 17.5,
      orientation: 'portrait-right',
    },
  },
};

const EXAMPLE_PRESETS: Preset[] = [
  {
    id: 'preset:pc-all',
    detectedName: 'PC All',
    customName: null,
    description: 'Every display on the gaming PC, keyboard and mouse follow.',
    icon: 'monitor',
    sortOrder: 0,
    assignments: {
      monitorSources: {
        [EXAMPLE_MONITOR_IDS.topLandscape]: EXAMPLE_COMPUTER_IDS.gamingPc,
        [EXAMPLE_MONITOR_IDS.bottomLandscape]: EXAMPLE_COMPUTER_IDS.gamingPc,
        [EXAMPLE_MONITOR_IDS.leftPortrait]: EXAMPLE_COMPUTER_IDS.gamingPc,
        [EXAMPLE_MONITOR_IDS.rightPortrait]: EXAMPLE_COMPUTER_IDS.gamingPc,
      },
      peripheralOwners: {
        [EXAMPLE_PERIPHERAL_IDS.keyboard]: EXAMPLE_COMPUTER_IDS.gamingPc,
        [EXAMPLE_PERIPHERAL_IDS.mouse]: EXAMPLE_COMPUTER_IDS.gamingPc,
      },
    },
  },
  {
    id: 'preset:work',
    detectedName: 'Work',
    customName: null,
    description: 'MacBook across the stack, gaming PC kept on the right rail.',
    icon: 'briefcase',
    sortOrder: 1,
    assignments: {
      monitorSources: {
        [EXAMPLE_MONITOR_IDS.topLandscape]: EXAMPLE_COMPUTER_IDS.m4MacBook,
        [EXAMPLE_MONITOR_IDS.bottomLandscape]: EXAMPLE_COMPUTER_IDS.m4MacBook,
        [EXAMPLE_MONITOR_IDS.leftPortrait]: EXAMPLE_COMPUTER_IDS.m4MacBook,
        [EXAMPLE_MONITOR_IDS.rightPortrait]: EXAMPLE_COMPUTER_IDS.gamingPc,
      },
      peripheralOwners: {
        [EXAMPLE_PERIPHERAL_IDS.keyboard]: EXAMPLE_COMPUTER_IDS.m4MacBook,
        [EXAMPLE_PERIPHERAL_IDS.mouse]: EXAMPLE_COMPUTER_IDS.m4MacBook,
      },
    },
  },
  {
    id: 'preset:gaming',
    detectedName: 'Gaming',
    customName: null,
    description: 'Centre stack on the PC, left rail on the MacBook for chat.',
    icon: 'gamepad',
    sortOrder: 2,
    assignments: {
      monitorSources: {
        [EXAMPLE_MONITOR_IDS.topLandscape]: EXAMPLE_COMPUTER_IDS.gamingPc,
        [EXAMPLE_MONITOR_IDS.bottomLandscape]: EXAMPLE_COMPUTER_IDS.gamingPc,
        [EXAMPLE_MONITOR_IDS.leftPortrait]: EXAMPLE_COMPUTER_IDS.m4MacBook,
        [EXAMPLE_MONITOR_IDS.rightPortrait]: EXAMPLE_COMPUTER_IDS.gamingPc,
      },
      peripheralOwners: {
        [EXAMPLE_PERIPHERAL_IDS.keyboard]: EXAMPLE_COMPUTER_IDS.gamingPc,
        [EXAMPLE_PERIPHERAL_IDS.mouse]: EXAMPLE_COMPUTER_IDS.gamingPc,
      },
    },
  },
];

/** First-run config. Written to disk once, then owned by the user. */
export function exampleDeskConfig(): DeskConfig {
  return {
    configVersion: 1,
    controller: { id: 'controller:local', name: 'Desk Controller' },
    layout: EXAMPLE_LAYOUT,
    presets: EXAMPLE_PRESETS,
    customNames: {
      computers: {
        [EXAMPLE_COMPUTER_IDS.gamingPc]: 'Gaming PC',
        [EXAMPLE_COMPUTER_IDS.m4MacBook]: 'M4 MacBook',
        [EXAMPLE_COMPUTER_IDS.m2MacBook]: 'M2 MacBook',
        [EXAMPLE_COMPUTER_IDS.surface]: 'Surface',
      },
      monitors: {
        [EXAMPLE_MONITOR_IDS.topLandscape]: 'Top',
        [EXAMPLE_MONITOR_IDS.bottomLandscape]: 'Bottom',
        [EXAMPLE_MONITOR_IDS.leftPortrait]: 'Left Rail',
        [EXAMPLE_MONITOR_IDS.rightPortrait]: 'Right Rail',
      },
      monitorInputs: {},
      peripherals: {},
    },
    peripherals: [
      {
        id: EXAMPLE_PERIPHERAL_IDS.keyboard,
        kind: 'keyboard',
        detectedName: 'Shared Keyboard',
        customName: null,
        switchId: EXAMPLE_SWITCH_ID,
        channelId: 'default',
      },
      {
        id: EXAMPLE_PERIPHERAL_IDS.mouse,
        kind: 'mouse',
        detectedName: 'Shared Mouse',
        customName: null,
        switchId: EXAMPLE_SWITCH_ID,
        channelId: 'default',
      },
    ],
    peripheralSwitches: [
      {
        id: EXAMPLE_SWITCH_ID,
        kind: 'peripheral-switch',
        detectedName: '4-port USB switch',
        customName: null,
        capabilities: ['switch-port', 'read-active-port'],
        channels: ['default'],
        driverBinding: 'controller',
        ports: [
          {
            id: 'port-1',
            detectedName: 'Port 1',
            customName: null,
            computerId: EXAMPLE_COMPUTER_IDS.gamingPc,
          },
          {
            id: 'port-2',
            detectedName: 'Port 2',
            customName: null,
            computerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
          },
          {
            id: 'port-3',
            detectedName: 'Port 3',
            customName: null,
            computerId: EXAMPLE_COMPUTER_IDS.m2MacBook,
          },
          {
            id: 'port-4',
            detectedName: 'Port 4',
            customName: null,
            computerId: EXAMPLE_COMPUTER_IDS.surface,
          },
        ],
      },
    ],
    wiringOverrides: {},
  };
}
