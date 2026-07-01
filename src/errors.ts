/** Thrown on any decode/prefix/checksum/character/format failure. */
export class InvalidHashError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'InvalidHashError';
  }
}
