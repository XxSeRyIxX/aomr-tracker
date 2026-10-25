import { deflateSync } from 'node:zlib';

/** Builds Steam binary KeyValues from a plain object: objects are sections, strings type 1, numbers int32. */
export function kv(tree) {
  const out = [];
  const name = text => out.push(...new TextEncoder().encode(text), 0);
  const write = node => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'object') {
        out.push(0);
        name(key);
        write(value);
        out.push(8);
      } else if (typeof value === 'string') {
        out.push(1);
        name(key);
        name(value);
      } else {
        out.push(2);
        name(key);
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setInt32(0, value, true);
        out.push(...bytes);
      }
    }
  };
  write(tree);
  out.push(8);
  return new Uint8Array(out).buffer;
}

/** The player's file: version 15, a base64 signature, the sizes, zlib JSON ending in NUL, then small extra records. */
export const playerFile = value => {
  const signature = Buffer.from(Buffer.alloc(32, 7).toString('base64'));
  const json = Buffer.concat([Buffer.from(JSON.stringify(value)), Buffer.from([0])]);
  const packed = deflateSync(json);
  const head = Buffer.alloc(8);
  head.writeInt32LE(15, 0);
  head.writeInt32LE(signature.length, 4);
  const sizes = Buffer.alloc(8);
  sizes.writeInt32LE(json.length, 0);
  sizes.writeInt32LE(packed.length, 4);
  const extra = Buffer.alloc(8);
  extra.writeInt32LE(3, 0);
  const empty = deflateSync(Buffer.from('[]\0'));
  extra.writeInt32LE(empty.length, 4);
  return Buffer.concat([head, signature, sizes, packed, extra, empty]);
};
