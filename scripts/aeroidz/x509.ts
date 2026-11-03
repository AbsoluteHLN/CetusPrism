/**
 * Dependency-free X.509 v3 certificate builder over node:crypto (ECDSA
 * P-256 / SHA-256). Used by the mTLS tests and the Aeroidz CA operations
 * script: no third-party crypto dependency enters the supply chain for
 * certificate issuance.
 */

import { createPublicKey, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

const encoder = new TextEncoder()

/** Minimal DER codec: every helper returns one complete TLV. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function lengthBytes(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length])
  const bytes: number[] = []
  let rest = length
  while (rest > 0) {
    bytes.unshift(rest & 0xff)
    rest >>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  return concat([new Uint8Array([tag]), lengthBytes(content.length), content])
}

function oidBytes(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number)
  const out = [parts[0] * 40 + parts[1]]
  for (const part of parts.slice(2)) {
    let value = part
    const stack = [value & 0x7f]
    value >>= 7
    while (value > 0) {
      stack.unshift((value & 0x7f) | 0x80)
      value >>= 7
    }
    out.push(...stack)
  }
  return new Uint8Array(out)
}

const seq = (...items: readonly Uint8Array[]): Uint8Array => tlv(0x30, concat(items))
const set = (...items: readonly Uint8Array[]): Uint8Array => tlv(0x31, concat(items))
const octetString = (content: Uint8Array): Uint8Array => tlv(0x04, content)
const bitString = (content: Uint8Array): Uint8Array => tlv(0x03, concat([new Uint8Array([0]), content]))
const utcTime = (date: Date): Uint8Array =>
  tlv(0x17, encoder.encode(date.toISOString().slice(2, 19).replace(/[-:T]/g, '') + 'Z'))
const printable = (value: string): Uint8Array => tlv(0x13, encoder.encode(value))
const oid = (dotted: string): Uint8Array => tlv(0x06, oidBytes(dotted))
const nullValue = (): Uint8Array => new Uint8Array([0x05, 0x00])
const explicit = (tagNumber: number, content: Uint8Array): Uint8Array => tlv(0xa0 + tagNumber, content)

function integer(bytes: Uint8Array): Uint8Array {
  const body = bytes[0] !== undefined && (bytes[0] & 0x80) !== 0
    ? concat([new Uint8Array([0]), bytes])
    : bytes
  return tlv(0x02, body)
}

/** OID registry (subset). */
const OID = {
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  ecPublicKey: '1.2.840.10045.2.1',
  prime256v1: '1.2.840.10045.3.1.7',
  commonName: '2.5.4.3',
  extensionRequest: '1.2.840.113549.1.9.14',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
} as const

function nameOf(cn: string): Uint8Array {
  return seq(set(seq(oid(OID.commonName), printable(cn))))
}

function ipBytes(ip: string): Uint8Array {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`only IPv4 SAN addresses are supported, got "${ip}"`)
  }
  return new Uint8Array(parts)
}

function extension(dotted: string, value: Uint8Array): Uint8Array {
  return seq(oid(dotted), octetString(value))
}

/** BasicConstraints: CA certificates may sign; leaves may not. */
function basicConstraints(isCa: boolean): Uint8Array {
  return extension(OID.basicConstraints, seq(...isCa ? [tlv(0x01, new Uint8Array([0xff]))] : []))
}

/** KeyUsage bit string: digitalSignature(0); CA adds keyCertSign(5)+cRLSign(6). */
function keyUsage(isCa: boolean): Uint8Array {
  const byte = isCa ? 0x8c : 0x80
  return extension(OID.keyUsage, bitString(new Uint8Array([byte])))
}

/** SubjectAlternativeName: dNSName entries and IPv4 entries. */
function subjectAltName(dnsNames: readonly string[], ips: readonly string[]): Uint8Array {
  const names = dnsNames.map(name => tlv(0x82, encoder.encode(name)))
  const addresses = ips.map(ip => tlv(0x87, ipBytes(ip)))
  return extension(OID.subjectAltName, seq(...names, ...addresses))
}

/** Issue one ECDSA P-256 certificate; returns the DER and its hex serial. */
export function buildCertificate(options: {
  readonly issuer: { readonly cn: string; readonly key: KeyObject }
  readonly subjectCn: string
  readonly serial: Uint8Array
  readonly notBefore: Date
  readonly notAfter: Date
  readonly isCa: boolean
  readonly subjectKey: KeyObject
  readonly dnsNames?: readonly string[]
  readonly ips?: readonly string[]
}): Uint8Array {
  const subjectSpki = new Uint8Array(createPublicKey(options.subjectKey).export({ type: 'spki', format: 'der' }))
  const extensions = [
    basicConstraints(options.isCa),
    keyUsage(options.isCa),
    ...options.isCa || (options.dnsNames === undefined && options.ips === undefined)
      ? []
      : [subjectAltName(options.dnsNames ?? [], options.ips ?? [])],
  ]
  const tbsCertificate = seq(
    explicit(0, integer(new Uint8Array([2]))),
    integer(options.serial),
    seq(oid(OID.ecdsaWithSha256), nullValue()),
    nameOf(options.issuer.cn),
    seq(utcTime(options.notBefore), utcTime(options.notAfter)),
    nameOf(options.subjectCn),
    subjectSpki,
    explicit(3, seq(...extensions)),
  )
  const signature = new Uint8Array(cryptoSign('sha256', tbsCertificate, options.issuer.key))
  return seq(
    tbsCertificate,
    seq(oid(OID.ecdsaWithSha256), nullValue()),
    bitString(signature),
  )
}

export interface CaMaterial {
  readonly key: KeyObject
  readonly keyPem: string
  readonly certDer: Uint8Array
  readonly certPem: string
  readonly cn: string
  readonly serialHex: string
}

export interface IssuedCertificate {
  readonly key: KeyObject
  readonly keyPem: string
  readonly certDer: Uint8Array
  readonly certPem: string
  readonly serialHex: string
}

function toPem(label: string, der: Uint8Array): string {
  const base64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`
}

function freshSerial(): { bytes: Uint8Array; hex: string } {
  const bytes = randomBytes(16)
  bytes[0] = bytes[0]! & 0x7f
  return { bytes, hex: Buffer.from(bytes).toString('hex').toUpperCase() }
}

function generateEcKey(): { key: KeyObject; keyPem: string } {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const key = pair.privateKey
  return { key, keyPem: key.export({ type: 'pkcs8', format: 'pem' }) as string }
}

/** Create a self-signed CA (valid ~10 years, may sign certificates and CRLs). */
export function createCa(cn: string, now = new Date()): CaMaterial {
  const { key, keyPem } = generateEcKey()
  const serial = freshSerial()
  const notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000)
  const certDer = buildCertificate({
    issuer: { cn, key },
    subjectCn: cn,
    serial: serial.bytes,
    notBefore: now,
    notAfter,
    isCa: true,
    subjectKey: key,
  })
  return {
    key,
    keyPem,
    certDer,
    certPem: toPem('CERTIFICATE', certDer),
    cn,
    serialHex: serial.hex,
  }
}

/** Issue a short-lived certificate under one CA. */
export function issueCertificate(
  ca: CaMaterial,
  options: {
    readonly cn: string
    readonly days?: number
    readonly dnsNames?: readonly string[]
    readonly ips?: readonly string[]
    readonly serial?: string
    readonly now?: Date
  },
): IssuedCertificate {
  const now = options.now ?? new Date()
  const days = options.days ?? 7
  const { key, keyPem } = generateEcKey()
  const serial = options.serial === undefined
    ? freshSerial()
    : { bytes: new Uint8Array(Buffer.from(options.serial, 'hex')), hex: options.serial.toUpperCase() }
  const certDer = buildCertificate({
    issuer: { cn: ca.cn, key: ca.key },
    subjectCn: options.cn,
    serial: serial.bytes,
    notBefore: now,
    notAfter: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
    isCa: false,
    subjectKey: key,
    ...options.dnsNames === undefined ? {} : { dnsNames: options.dnsNames },
    ...options.ips === undefined ? {} : { ips: options.ips },
  })
  return {
    key,
    keyPem,
    certDer,
    certPem: toPem('CERTIFICATE', certDer),
    serialHex: serial.hex,
  }
}

/** Extract the subject CN from one certificate this module issued. */
export function cnOf(certDer: Uint8Array): string {
  // Walk for OID 2.5.4.3 (06 03 55 04 03) then read the following string.
  for (let index = 0; index + 5 < certDer.length; index += 1) {
    if (certDer[index] === 0x06 && certDer[index + 1] === 0x03
      && certDer[index + 2] === 0x55 && certDer[index + 3] === 0x04 && certDer[index + 4] === 0x03) {
      const tagOffset = index + 5
      const tag = certDer[tagOffset]
      const length = certDer[tagOffset + 1]
      if ((tag === 0x13 || tag === 0x0c) && length !== undefined && length < 128) {
        const start = tagOffset + 2
        return new TextDecoder().decode(certDer.slice(start, start + length))
      }
    }
  }
  throw new Error('no subject CN found in certificate')
}

/** Split a PEM bundle into individual DER certificates. */
export function parsePemCertificates(pem: string): Uint8Array[] {
  const pattern = /-----BEGIN CERTIFICATE-----([^-]+)-----END CERTIFICATE-----/g
  const out: Uint8Array[] = []
  for (let match = pattern.exec(pem); match !== null; match = pattern.exec(pem)) {
    out.push(new Uint8Array(Buffer.from(match[1].replace(/\s+/g, ''), 'base64')))
  }
  return out
}
