import { EventEmitter } from "events";

export const eventEmitter = new EventEmitter();

export type EventPayload = Record<string, unknown>;

export default eventEmitter;
