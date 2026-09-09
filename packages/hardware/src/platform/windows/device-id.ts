import { buildMonitorId } from '@desk-control/domain';

/**
 * Windows names the same monitor two different ways, and they have to be joined
 * before an EDID serial can be attached to a DDC handle.
 *
 *   WMI WmiMonitorID.InstanceName
 *     DISPLAY\AUS276D\7&2d237c0c&0&UID16641_0
 *
 *   EnumDisplayDevices device interface path
 *     \\?\DISPLAY#AUS276D#7&2d237c0c&0&UID16641#{e6f07b5f-ee97-...}
 *
 * Same device, different punctuation, plus a trailing instance ordinal on one
 * and an interface GUID on the other. Normalising both to
 * `display\aus276d\7&2d237c0c&0&uid16641` makes the join exact rather than a
 * guess based on ordering.
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

export interface WindowsEdidRecord {
  instanceName: string;
  manufacturerId: string;
  friendlyName: string | null;
  productCode: string | null;
  serial: string | null;
  yearOfManufacture: number | null;
}

export interface WindowsMonitorIdentity {
  stableId: string;
  detectedName: string;
  manufacturerId: string;
  model: string;
  serial: string | null;
  manufactureYear: number | null;
  weakIdentity: boolean;
}

/**
 * Builds the cross-platform stable id from Windows-specific facts.
 *
 * The id must come out identical to what a macOS or Linux agent computes for
 * the same panel, because that is how the controller merges control paths. So
 * it is derived only from EDID values - manufacturer, model, serial - and never
 * from anything Windows-shaped like an adapter name or instance path.
 *
 * `capabilitiesModel` is the model string the monitor reports over DDC, used
 * when EDID has no friendly name. `fallbackDisambiguator` is the adapter name,
 * used only for panels with no serial at all, which produces a weak identity.
 */
export function buildWindowsMonitorIdentity(input: {
  edid: WindowsEdidRecord | null;
  capabilitiesModel: string | null;
  fallbackDisambiguator: string;
}): WindowsMonitorIdentity {
  const manufacturerId = input.edid?.manufacturerId ?? 'UNK';
  const model =
    input.edid?.friendlyName ??
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

  const detectedName = input.edid?.friendlyName
    ? `${manufacturerId} ${input.edid.friendlyName}`
    : (input.capabilitiesModel ?? model);

  return {
    stableId: id,
    detectedName,
    manufacturerId,
    model,
    serial,
    manufactureYear: input.edid?.yearOfManufacture ?? null,
    weakIdentity: weak,
  };
}
