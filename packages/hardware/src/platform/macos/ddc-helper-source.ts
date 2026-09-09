/**
 * The macOS DDC helper, embedded as C source and compiled on first run.
 *
 * Why C and why so small: on Apple Silicon the only route to a monitor's DDC
 * channel is raw I2C through IOAVService, which is reachable only from native
 * code. Everything that can be done in TypeScript has been - packet framing,
 * checksums, capability fetching, EDID parsing, identity - leaving this helper
 * with three jobs: enumerate displays, copy EDID, and move bytes over I2C.
 *
 * That matters because this is the one part of the system that cannot be tested
 * without a Mac. Keeping it thin keeps the untested surface small and the
 * failure modes obvious.
 *
 * Compiled once with clang into a temp file, keyed by a hash of this source.
 *
 * Protocol - plain text in (so the C stays trivial), JSON out:
 *   <id> ping
 *   <id> list
 *   <id> read <deviceId> <length>
 *   <id> write <deviceId> <hexPayload>
 */
export const MACOS_DDC_HELPER_SOURCE = String.raw`
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>

/*
 * Private IOKit AV service API. Not in any public header, but present in the
 * IOKit framework binary on Apple Silicon. If these ever stop resolving the
 * helper fails to link, and the provider reports that clearly rather than
 * pretending a monitor is unreachable.
 */
typedef CFTypeRef IOAVServiceRef;
extern IOAVServiceRef IOAVServiceCreateWithService(CFAllocatorRef allocator, io_service_t service);
extern IOReturn IOAVServiceCopyEDID(IOAVServiceRef service, CFDataRef *edid);
extern IOReturn IOAVServiceReadI2C(IOAVServiceRef service, uint32_t chipAddress,
                                   uint32_t dataAddress, void *outputBuffer,
                                   uint32_t outputBufferSize);
extern IOReturn IOAVServiceWriteI2C(IOAVServiceRef service, uint32_t chipAddress,
                                    uint32_t dataAddress, void *inputBuffer,
                                    uint32_t inputBufferSize);

#define DDC_CHIP_ADDRESS 0x37
#define DDC_DATA_ADDRESS 0x51
#define MAX_MONITORS 16
#define MAX_BUFFER 256

typedef struct {
  uint64_t entryId;
  IOAVServiceRef service;
  char description[128];
  char edidHex[1024];
} Monitor;

static Monitor monitors[MAX_MONITORS];
static int monitorCount = 0;

static void emitReady(void) {
  printf("{\"id\":\"ready\",\"ok\":true,\"result\":{\"ready\":true}}\n");
  fflush(stdout);
}

static void emitError(const char *id, const char *code, const char *message) {
  printf("{\"id\":\"%s\",\"ok\":false,\"error\":{\"code\":\"%s\",\"message\":\"%s\"}}\n",
         id, code, message);
  fflush(stdout);
}

static void toHex(const uint8_t *bytes, size_t length, char *out) {
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < length; i++) {
    out[i * 2] = digits[(bytes[i] >> 4) & 0xF];
    out[i * 2 + 1] = digits[bytes[i] & 0xF];
  }
  out[length * 2] = 0;
}

static int fromHex(const char *hex, uint8_t *out, int maxLength) {
  int length = 0;
  while (hex[0] && hex[1] && length < maxLength) {
    char pair[3] = {hex[0], hex[1], 0};
    out[length++] = (uint8_t)strtol(pair, NULL, 16);
    hex += 2;
  }
  return length;
}

static void copyCFString(CFStringRef source, char *out, size_t size) {
  out[0] = 0;
  if (source == NULL) return;
  CFStringGetCString(source, out, (CFIndex)size, kCFStringEncodingUTF8);
}

/* Reads EDID, preferring the AV service and falling back to I2C at 0x50. */
static void readEdid(IOAVServiceRef service, char *out) {
  out[0] = 0;

  CFDataRef data = NULL;
  if (IOAVServiceCopyEDID(service, &data) == kIOReturnSuccess && data != NULL) {
    CFIndex length = CFDataGetLength(data);
    if (length > 0 && length <= 512) {
      toHex(CFDataGetBytePtr(data), (size_t)length, out);
    }
    CFRelease(data);
    if (out[0]) return;
  }

  uint8_t block[128];
  memset(block, 0, sizeof(block));
  if (IOAVServiceReadI2C(service, 0x50, 0x00, block, sizeof(block)) == kIOReturnSuccess) {
    /* Only trust it if the EDID header signature is present. */
    if (block[0] == 0x00 && block[1] == 0xFF && block[7] == 0x00) {
      toHex(block, sizeof(block), out);
    }
  }
}

/*
 * Enumerates external displays.
 *
 * DCPAVServiceProxy is the Apple Silicon display pipeline. "Location" tells the
 * built-in panel from external ones; the built-in has no DDC to speak of.
 */
static void discover(void) {
  monitorCount = 0;

  io_iterator_t iterator = 0;
  if (IOServiceGetMatchingServices(kIOMainPortDefault,
                                   IOServiceMatching("DCPAVServiceProxy"),
                                   &iterator) != kIOReturnSuccess) {
    return;
  }

  io_service_t entry = 0;
  while ((entry = IOIteratorNext(iterator)) != 0 && monitorCount < MAX_MONITORS) {
    CFStringRef location =
        IORegistryEntryCreateCFProperty(entry, CFSTR("Location"), kCFAllocatorDefault, 0);
    int isExternal = location != NULL &&
                     CFStringCompare(location, CFSTR("External"), 0) == kCFCompareEqualTo;
    if (location) CFRelease(location);
    if (!isExternal) {
      IOObjectRelease(entry);
      continue;
    }

    IOAVServiceRef service = IOAVServiceCreateWithService(kCFAllocatorDefault, entry);
    if (service == NULL) {
      IOObjectRelease(entry);
      continue;
    }

    uint64_t entryId = 0;
    IORegistryEntryGetRegistryEntryID(entry, &entryId);

    Monitor *monitor = &monitors[monitorCount];
    monitor->entryId = entryId;
    monitor->service = service;

    io_name_t name;
    if (IORegistryEntryGetName(entry, name) == kIOReturnSuccess) {
      snprintf(monitor->description, sizeof(monitor->description), "%s", name);
    } else {
      copyCFString(NULL, monitor->description, sizeof(monitor->description));
    }

    readEdid(service, monitor->edidHex);
    monitorCount++;
    IOObjectRelease(entry);
  }

  IOObjectRelease(iterator);
}

static Monitor *findMonitor(uint64_t entryId) {
  for (int i = 0; i < monitorCount; i++) {
    if (monitors[i].entryId == entryId) return &monitors[i];
  }
  return NULL;
}

static void handleList(const char *id) {
  printf("{\"id\":\"%s\",\"ok\":true,\"result\":{\"monitors\":[", id);
  for (int i = 0; i < monitorCount; i++) {
    printf("%s{\"deviceId\":\"%llu\",\"description\":\"%s\",\"edidHex\":%s%s%s}",
           i == 0 ? "" : ",",
           (unsigned long long)monitors[i].entryId,
           monitors[i].description,
           monitors[i].edidHex[0] ? "\"" : "null",
           monitors[i].edidHex[0] ? monitors[i].edidHex : "",
           monitors[i].edidHex[0] ? "\"" : "");
  }
  printf("]}}\n");
  fflush(stdout);
}

int main(void) {
  discover();
  emitReady();

  char line[4096];
  while (fgets(line, sizeof(line), stdin) != NULL) {
    char id[64] = {0};
    char op[32] = {0};
    if (sscanf(line, "%63s %31s", id, op) < 2) continue;

    if (strcmp(op, "ping") == 0) {
      printf("{\"id\":\"%s\",\"ok\":true,\"result\":{\"pong\":true}}\n", id);
      fflush(stdout);
      continue;
    }

    if (strcmp(op, "list") == 0) {
      /* Re-enumerate so a hotplug is picked up without a restart. */
      discover();
      handleList(id);
      continue;
    }

    if (strcmp(op, "read") == 0) {
      unsigned long long entryId = 0;
      int length = 0;
      if (sscanf(line, "%63s %31s %llu %d", id, op, &entryId, &length) < 4) {
        emitError(id, "INVALID_MESSAGE", "read needs a device id and a length");
        continue;
      }
      Monitor *monitor = findMonitor(entryId);
      if (monitor == NULL) {
        emitError(id, "UNKNOWN_TARGET", "No such display");
        continue;
      }
      if (length <= 0 || length > MAX_BUFFER) length = 12;

      uint8_t buffer[MAX_BUFFER];
      memset(buffer, 0, sizeof(buffer));
      IOReturn result = IOAVServiceReadI2C(monitor->service, DDC_CHIP_ADDRESS,
                                           DDC_DATA_ADDRESS, buffer, (uint32_t)length);
      if (result != kIOReturnSuccess) {
        emitError(id, "DEVICE_UNREACHABLE", "IOAVServiceReadI2C failed");
        continue;
      }

      char hex[MAX_BUFFER * 2 + 1];
      toHex(buffer, (size_t)length, hex);
      printf("{\"id\":\"%s\",\"ok\":true,\"result\":{\"dataHex\":\"%s\"}}\n", id, hex);
      fflush(stdout);
      continue;
    }

    if (strcmp(op, "write") == 0) {
      unsigned long long entryId = 0;
      char hex[MAX_BUFFER * 2 + 1] = {0};
      if (sscanf(line, "%63s %31s %llu %512s", id, op, &entryId, hex) < 4) {
        emitError(id, "INVALID_MESSAGE", "write needs a device id and a hex payload");
        continue;
      }
      Monitor *monitor = findMonitor(entryId);
      if (monitor == NULL) {
        emitError(id, "UNKNOWN_TARGET", "No such display");
        continue;
      }

      uint8_t buffer[MAX_BUFFER];
      int length = fromHex(hex, buffer, MAX_BUFFER);
      IOReturn result = IOAVServiceWriteI2C(monitor->service, DDC_CHIP_ADDRESS,
                                            DDC_DATA_ADDRESS, buffer, (uint32_t)length);
      if (result != kIOReturnSuccess) {
        emitError(id, "DEVICE_UNREACHABLE", "IOAVServiceWriteI2C failed");
        continue;
      }

      printf("{\"id\":\"%s\",\"ok\":true,\"result\":{\"written\":true}}\n", id);
      fflush(stdout);
      continue;
    }

    emitError(id, "UNKNOWN_COMMAND_KIND", "Unsupported op");
  }

  return 0;
}
`;
