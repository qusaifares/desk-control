import { buildMonitorId } from '@desk-control/domain';
import type { EdidIdentity } from './edid.js';

/**
 * Normalises the several ways a platform can name the same display, so raw EDID
 * can be joined to a DDC handle without relying on enumeration order.
 *
 * Windows is the awkward case - it names one monitor two different ways:
 *
 *   WMI WmiMonitorID.InstanceName
 *     DISPLAY\AUS276D\7&2d237c0c&0&UID16641_0
 *
 *   EnumDisplayDevices device interface path
 *     \\?\DISPLAY#AUS276D#7&2d237c0c&0&UID16641#{e6f07b5f-ee97-...}
 *
 * Same device, different punctuation, plus a trailing instance ordinal on one
 * and an interface GUID on the other. Normalising both to
 * `display\aus276d\7&2d237c0c&0&uid16641` makes the join exact.
 *
 * On platforms whose helper already keys EDID by the same handle it reports for
 * the monitor - macOS does - this is simply a case fold.
 */
export function normalizeDeviceKey(value: string): string {
  const withoutPrefix = value.replace(/^\\\\[?.]\\/, '');
  const unified = withoutPrefix.replace(/#/g, '\\');
  const parts = unified.split('\\').filter((part) => part.length > 0);

  // Drop a trailing interface GUID, e.g. {e6f07b5f-...}
  const withoutGuid = parts.filter((part) => !/^\{[0-9a-fA-F-]+\}$/.test(part));

  // Keep enumerator\hardwareId\instanceId and drop a trailing _0 ordinal.
  const keep = withoutGuid.slice(0, 3);
  const last = keep[keep.length - 1];
  if (last !== undefined) keep[keep.length - 1] = last.replace(/_\d+$/, '');

  return keep.join('\\').toLowerCase();
}

export interface DdcMonitorIdentity {
  stableId: string;
  detectedName: string;
  manufacturerId: string;
  model: string;
  serial: string | null;
  manufactureYear: number | null;
  weakIdentity: boolean;
  physicalSizeInches: number | null;
}

/**
 * Builds the stable id every platform must agree on.
 *
 * Derived only from EDID - manufacturer, model, serial - and never from
 * anything platform-shaped like an adapter name or an IOKit path, because a
 * Windows agent and a macOS agent looking at the same panel have to arrive at
 * the same id or the controller cannot merge their control paths.
 *
 * `capabilitiesModel` is the model the monitor reports over DDC, used when EDID
 * carries no name. `fallbackDisambiguator` is a platform handle, used only for
 * panels with no usable serial, which yields a weak identity.
 */
export function buildDdcMonitorIdentity(input: {
  edid: EdidIdentity | null;
  capabilitiesModel: string | null;
  fallbackDisambiguator: string;
}): DdcMonitorIdentity {
  const manufacturerId = input.edid?.manufacturerId ?? 'UNK';
  const model =
    input.edid?.monitorName ??
    input.capabilitiesModel ??
    input.edid?.productCode ??
    'Unknown monitor';
  const serial = input.edid?.serial && input.edid.serial.length > 0 ? input.edid.serial : null;

  const { id, weak } = buildMonitorId({
    manufacturerId,
    model,
    serial: serial ?? undefined,
    disambiguator: input.fallbackDisambiguator,
  });

  const detectedName = input.edid?.monitorName
    ? `${manufacturerId} ${input.edid.monitorName}`
    : (input.capabilitiesModel ?? model);

  return {
    stableId: id,
    detectedName,
    manufactureYear: input.edid?.manufactureYear ?? null,
    physicalSizeInches: input.edid?.physicalSizeInches ?? null,
    manufacturerId,
    model,
    serial,
    weakIdentity: weak,
  };
}
