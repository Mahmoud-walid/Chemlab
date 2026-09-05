/**
 * Truncating an IP address before it is stored.
 *
 * Pure, so the rules can be tested without a request.
 *
 * An IP address identifies a person more precisely than most people expect,
 * and #19 asks for it to be truncated unless full retention is justified for
 * abuse investigation. Nothing in this platform investigates abuse by IP yet,
 * so nothing here keeps a whole one.
 *
 * IPv4 loses its last octet — 203.0.113.42 becomes 203.0.113.0, which is the
 * conventional /24 and still says roughly where a request came from. IPv6
 * loses its last 80 bits, keeping the /48 that identifies a site rather than a
 * device. Both are one-way: what is stored cannot be widened back.
 */

/** The first address in an `X-Forwarded-For` chain: proxies append. */
export function clientAddress(forwardedFor: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first && first !== "" ? first : null;
}

export function truncateIp(address: string | null): string | null {
  if (!address) return null;

  // IPv4, or an IPv4-mapped IPv6 address like ::ffff:203.0.113.42.
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    address,
  );
  if (v4) {
    const octets = [v4[1], v4[2], v4[3]].map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
      return null;
    }
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  if (address.includes(":")) {
    // Keep the first three hextets (/48). `::` expansion is not attempted:
    // a compressed address that reaches here keeps only what precedes the
    // compression, which is never MORE than a /48.
    const kept = address.split(":").slice(0, 3).filter(Boolean);
    if (kept.length === 0) return null;
    return `${kept.join(":")}::`;
  }

  // Not an address we recognise. Storing an unparsed string would be storing
  // something we cannot promise is truncated.
  return null;
}
