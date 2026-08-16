// Copyright (C) 2025 Autodesk Inc.
// All rights reserved.

import { core as adsk_core } from "./core";
import { fusion as adsk_fusion } from "./fusion";
import { cam as adsk_cam } from "./cam";
import { volume as adsk_volume } from "./volume";
import { sim as adsk_sim } from "./sim";
import { drawing as adsk_drawing } from "./drawing";
import { electron as adsk_electron } from "./electron";

export import core = adsk_core;
export import fusion = adsk_fusion;
export import cam = adsk_cam;
export import volume = adsk_volume;
export import sim = adsk_sim;
export import drawing = adsk_drawing;
export import electron = adsk_electron;

export namespace adsk {
  export import core = adsk_core;
  export import fusion = adsk_fusion;
  export import cam = adsk_cam;
  export import volume = adsk_volume;
  export import sim = adsk_sim;
  export import drawing = adsk_drawing;
  export import electron = adsk_electron;

  /**
   * Temporarily halts the execution of the add-in or script and
   * gives Fusion a chance to handle any queued up messages.
   * @returns Returns True if the call was successful.
   */
  export function doEvents(): boolean;

  /**
   * Serialized JSON object passed to script containing custom parameters.
   */
  export var parameters: string;

  /**
   * Serialized JSON object returned to script's caller following successful execution.
   */
  export var result: string;

  /**
   * Log messages returned to script's caller during execution.
   */
  export function log(message: any): void;

  /**
   * Creates a Base64-encoded ASCII string from a binary string.
   */
  export function btoa(
    data: string | Uint8Array,
    urlSafe?: boolean/* = false*/
  ): string;

  /**
   * Decodes a string of data which has been encoded using Base64 encoding.
   */
  export function atob(
    data: string | Uint8Array,
    urlSafe?: boolean/* = false*/
  ): string;

  /**
   * Reads the text/JSON file and returns as string.
   */
  export function readFileSync(path: string): string;

  /**
   * Reads the binary file and returns as buffer.
   */
  export function readBufferSync(path: string): Uint8Array;

  /**
   * Writes the text Bytes contents into file.
   * Supported format types: utf8, binary. Default format - utf8.
   */
  export function writeFileSync(
    path: string,
    data: string,
    format: string/* = utf8*/
  ): void;

  /**
   * Writes the UTF8/Raw Bytes contents into file.
   */ 
  export function writeBufferSync(
    path: string,
    buffer: Uint8Array
  ): void;

  /**
   * Download a base64 encoded file.
   * @param {object} dataFile The data file to download.
   * @returns {string} The base64 encoded file.
   */
  export function downloadDataFileAsBase64(
    dataFile: adsk.core.DataFile
  ): string;

  /**
   * Report the current status of the workitem.
   * @param {string} status The status of the workitem.
   * @returns {boolean} 0 if the status was successfully reported.
   */
  export function reportWorkitemStatus(status: string): boolean;

  /**
   * Report the current status of the workitem.
   * @param {string} progress The progress of the workitem.
   * @returns {number} The progress of the workitem.
   */
  export function onProgress(progress: string): number;

  /**
   * Ask for additional data to be downloaded on demand.
   * @param {string} name Name of the onDemand input parameter as specified in the Activity.
   * @param {string} suffix A query string - optional parameters that can be addded to the url
   *                 defined in the WorkItem.
   * @param {string} headers HTTP call headers.
   * @param {string} responseFile Tells the system the filename under which the onDemand file.
   *                  is saved by the http call, must start with 'file://'
   * @returns {string} The path to the downloaded file.
   */
  export function getOnDemandFile(
    name: string,
    suffix: string,
    headers: string,
    responseFile: string,
  ): string;

  /**
   * Forces the script or add-in to immediately terminate. Particularly useful
   * when autoTerminate has been set to false for a script, allowing you to
   * control exactly when the script will terminate.
   */
  export function terminate(): void;

  /**
   * Gets or sets whether the script automatically terminates after execution.
   * Scripts default to true (auto-terminate); add-ins default to false.
   * Set to false to keep a script running beyond its initial execution,
   * for example to continue handling events.
   */
  export var autoTerminate: boolean;
}

declare global {

/* Represents the headers associated with an HTTP response from a fetch request. */
interface FetchHeaders {
    /* Returns the value of the specified header, or null if the header does not exist. Header name lookup is case-insensitive. */
    get(name: string): string | null;
    /* Returns true if a header with the given name exists in this collection. */
    has(name: string): boolean;
    /* Iterates over all headers, invoking the callback with each header's value, key, and the parent FetchHeaders object. */
    forEach(callback: (value: string, key: string, parent: FetchHeaders) => void): void;
    /* Returns an array of all header names in the collection. */
    keys(): string[];
    /* Returns an array of all header values in the collection. */
    values(): string[];
    /* Returns an array of [name, value] pairs for every header in the collection. */
    entries(): [string, string][];
}

/* Represents the response to an HTTP request made via the global fetch API. */
interface FetchResponse {
    /* The HTTP status code of the response (e.g. 200, 404). */
    readonly status: number;
    /* The status message corresponding to the HTTP status code (e.g. "OK", "Not Found"). */
    readonly statusText: string;
    /* True if the response status is in the successful range (200–299). */
    readonly ok: boolean;
    /* The final URL of the response after any redirects have been followed. */
    readonly url: string;
    /* The type of the response (e.g. "basic", "cors"). */
    readonly type: string;
    /* True if the response was obtained through one or more redirects. */
    readonly redirected: boolean;
    /* True if the response body has already been consumed by a read method (text, json, or arrayBuffer). */
    readonly bodyUsed: boolean;
    /* The headers associated with this response. */
    readonly headers: FetchHeaders;
    /* Reads the response body and returns it as a string. The body can only be consumed once. */
    text(): Promise<string>;
    /* Reads the response body, parses it as JSON, and returns the resulting value. The body can only be consumed once. */
    json(): Promise<any>;
    /* Reads the response body and returns it as an ArrayBuffer. The body can only be consumed once. */
    arrayBuffer(): Promise<ArrayBuffer>;
}

/* Configuration options for an HTTP request made via the global fetch API. */
interface RequestInit {
    /* The HTTP method to use (e.g. "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"). Defaults to "GET". */
    method?: string;
    /* Key-value pairs representing HTTP headers to include with the request. */
    headers?: Record<string, string>;
    /* The request body content. Not permitted for GET or HEAD requests. */
    body?: string | ArrayBuffer | Uint8Array;
}

/*
 * Initiates an asynchronous HTTP request and returns a Promise that resolves to a FetchResponse.
 * The promise is resolved when the host application processes idle tasks (via adsk.doEvents).
 * Network errors cause the promise to reject; HTTP error status codes (4xx, 5xx) still resolve normally.
 * @param url The URL to fetch.
 * @param init Optional request configuration (method, headers, body).
 */
function fetch(url: string, init?: RequestInit): Promise<FetchResponse>;

} /* declare global */
