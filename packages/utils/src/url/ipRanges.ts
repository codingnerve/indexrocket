import { isIPv4, isIPv6 } from 'node:net';

interface Cidr {
  readonly base: bigint;
  readonly mask: bigint;
  readonly label: string;
}

function ipv4ToBigInt(address: string): bigint {
  const octets = address.split('.');

  if (octets.length !== 4) {
    throw new Error(`Malformed IPv4 address: ${address}`);
  }

  return octets.reduce((total, octet) => {
    const value = Number(octet);

    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Malformed IPv4 address: ${address}`);
    }

    return (total << 8n) | BigInt(value);
  }, 0n);
}

function expandIPv6(address: string): string[] {
  const [head = '', tail = ''] = address.split('::', 2);
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');

  if (!address.includes('::')) {
    return address.split(':');
  }

  const missing = 8 - headGroups.length - tailGroups.length;

  return [...headGroups, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailGroups];
}

function ipv6ToBigInt(address: string): bigint {
  // An IPv4-mapped suffix (::ffff:192.0.2.1) must be folded into the numeric form.
  const mapped = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(address);
  let working = address;

  if (mapped !== null && mapped[1] !== undefined && mapped[2] !== undefined) {
    const embedded = ipv4ToBigInt(mapped[2]);
    const high = (embedded >> 16n) & 0xffffn;
    const low = embedded & 0xffffn;
    working = `${mapped[1]}${high.toString(16)}:${low.toString(16)}`;
  }

  const groups = expandIPv6(working);

  if (groups.length !== 8) {
    throw new Error(`Malformed IPv6 address: ${address}`);
  }

  return groups.reduce((total, group) => {
    const value = group === '' ? 0 : Number.parseInt(group, 16);

    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`Malformed IPv6 address: ${address}`);
    }

    return (total << 16n) | BigInt(value);
  }, 0n);
}

function cidr(address: string, prefix: number, bits: number, label: string): Cidr {
  const base = bits === 32 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);

  return { base: base & mask, mask, label };
}

/** IPv4 space that must never be contacted by the inspector. */
const BLOCKED_IPV4: readonly Cidr[] = [
  cidr('0.0.0.0', 8, 32, 'this-network'),
  cidr('10.0.0.0', 8, 32, 'private'),
  cidr('100.64.0.0', 10, 32, 'carrier-grade NAT'),
  cidr('127.0.0.0', 8, 32, 'loopback'),
  cidr('169.254.0.0', 16, 32, 'link-local / cloud metadata'),
  cidr('172.16.0.0', 12, 32, 'private'),
  cidr('192.0.0.0', 24, 32, 'IETF protocol assignments'),
  cidr('192.0.2.0', 24, 32, 'documentation'),
  cidr('192.88.99.0', 24, 32, '6to4 relay anycast'),
  cidr('192.168.0.0', 16, 32, 'private'),
  cidr('198.18.0.0', 15, 32, 'benchmarking'),
  cidr('198.51.100.0', 24, 32, 'documentation'),
  cidr('203.0.113.0', 24, 32, 'documentation'),
  cidr('224.0.0.0', 4, 32, 'multicast'),
  cidr('240.0.0.0', 4, 32, 'reserved'),
];

/** IPv6 space that must never be contacted by the inspector. */
const BLOCKED_IPV6: readonly Cidr[] = [
  cidr('::', 128, 128, 'unspecified'),
  cidr('::1', 128, 128, 'loopback'),
  cidr('::', 96, 128, 'IPv4-compatible'),
  cidr('::ffff:0:0', 96, 128, 'IPv4-mapped'),
  cidr('64:ff9b::', 96, 128, 'NAT64'),
  cidr('100::', 64, 128, 'discard-only'),
  cidr('2001:db8::', 32, 128, 'documentation'),
  cidr('fc00::', 7, 128, 'unique local'),
  cidr('fe80::', 10, 128, 'link-local'),
  cidr('ff00::', 8, 128, 'multicast'),
];

export interface BlockedRange {
  blocked: boolean;
  reason: string | null;
}

/**
 * Classifies a literal IP address. IPv4-mapped IPv6 addresses are folded to their
 * embedded IPv4 form first so `::ffff:127.0.0.1` cannot slip past the IPv4 rules.
 */
export function classifyAddress(address: string): BlockedRange {
  if (isIPv4(address)) {
    const value = ipv4ToBigInt(address);
    const hit = BLOCKED_IPV4.find((range) => (value & range.mask) === range.base);

    return hit === undefined ? { blocked: false, reason: null } : { blocked: true, reason: hit.label };
  }

  if (isIPv6(address)) {
    const mappedIpv4 = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(address);

    if (mappedIpv4 !== null && mappedIpv4[1] !== undefined) {
      return classifyAddress(mappedIpv4[1]);
    }

    const value = ipv6ToBigInt(address);
    const mappedRange = BLOCKED_IPV6.find((range) => range.label === 'IPv4-mapped');

    if (mappedRange !== undefined && (value & mappedRange.mask) === mappedRange.base) {
      const embedded = value & 0xffffffffn;
      const octets = [
        (embedded >> 24n) & 0xffn,
        (embedded >> 16n) & 0xffn,
        (embedded >> 8n) & 0xffn,
        embedded & 0xffn,
      ];

      return classifyAddress(octets.join('.'));
    }

    const hit = BLOCKED_IPV6.find((range) => (value & range.mask) === range.base);

    return hit === undefined ? { blocked: false, reason: null } : { blocked: true, reason: hit.label };
  }

  return { blocked: true, reason: 'not a valid IP address' };
}

export function isPublicAddress(address: string): boolean {
  return !classifyAddress(address).blocked;
}
