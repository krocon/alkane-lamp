// Copyright (C) 2025 Autodesk Inc.
// All rights reserved.

/*
 * File system module providing synchronous and callback-based file operations.
 * All paths are relative to the restricted script working directory.
 * Async callbacks run when the main thread processes idle tasks (via adsk.doEvents).
 */

/*
 * Reads the entire contents of a file synchronously and returns the raw bytes as a Uint8Array.
 * @param path The path to the file to read.
 */
export function readFileSync(path: string): Uint8Array;
/*
 * Reads the entire contents of a file synchronously using the specified encoding.
 * When encoding is "utf8", returns the content as a string.
 * @param path The path to the file to read.
 * @param encoding The character encoding to use (e.g. "utf8").
 */
export function readFileSync(path: string, encoding: string): string | Uint8Array;

/*
 * Reads the entire contents of a file asynchronously.
 * The callback receives an error string or null, and the raw file data as a Uint8Array.
 * @param path The path to the file to read.
 * @param callback Invoked with an error string (or null on success) and the file data.
 */
export function readFile(path: string, callback: (err: string | null, data?: string | Uint8Array) => void): void;
/*
 * Reads the entire contents of a file asynchronously using the specified encoding.
 * The callback receives an error string or null, and the decoded file data.
 * @param path The path to the file to read.
 * @param encoding The character encoding to use (e.g. "utf8").
 * @param callback Invoked with an error string (or null on success) and the decoded file data.
 */
export function readFile(path: string, encoding: string, callback: (err: string | null, data?: string | Uint8Array) => void): void;

/*
 * Writes data to a file synchronously, replacing the file if it already exists.
 * @param path The path to the file to write.
 * @param data The content to write, as a string or Uint8Array.
 */
export function writeFileSync(path: string, data: string | Uint8Array): void;
/*
 * Writes data to a file asynchronously, replacing the file if it already exists.
 * @param path The path to the file to write.
 * @param data The content to write, as a string or Uint8Array.
 * @param callback Invoked with an error string (or null on success) upon completion.
 */
export function writeFile(path: string, data: string | Uint8Array, callback: (err: string | null) => void): void;

/*
 * Appends the given string data to a file synchronously. Creates the file if it does not exist.
 * @param path The path to the file to append to.
 * @param data The string content to append.
 */
export function appendFileSync(path: string, data: string): void;
/*
 * Appends the given string data to a file asynchronously. Creates the file if it does not exist.
 * @param path The path to the file to append to.
 * @param data The string content to append.
 * @param callback Invoked with an error string (or null on success) upon completion.
 */
export function appendFile(path: string, data: string, callback: (err: string | null) => void): void;

/*
 * Deletes a file synchronously. Throws if the file does not exist.
 * @param path The path to the file to delete.
 */
export function unlinkSync(path: string): void;
/*
 * Deletes a file asynchronously.
 * @param path The path to the file to delete.
 * @param callback Invoked with an error string (or null on success) upon completion.
 */
export function unlink(path: string, callback: (err: string | null) => void): void;

/*
 * Renames or moves a file or directory synchronously.
 * @param oldPath The current path of the file or directory.
 * @param newPath The new path for the file or directory.
 */
export function renameSync(oldPath: string, newPath: string): void;
/*
 * Renames or moves a file or directory asynchronously.
 * @param oldPath The current path of the file or directory.
 * @param newPath The new path for the file or directory.
 * @param callback Invoked with an error string (or null on success) upon completion.
 */
export function rename(oldPath: string, newPath: string, callback: (err: string | null) => void): void;

/*
 * Copies a file synchronously. Overwrites the destination if it already exists.
 * @param src The path to the source file.
 * @param dest The path to the destination file.
 */
export function copyFileSync(src: string, dest: string): void;
/*
 * Copies a file asynchronously. Overwrites the destination if it already exists.
 * @param src The path to the source file.
 * @param dest The path to the destination file.
 * @param callback Invoked with an error string (or null on success) upon completion.
 */
export function copyFile(src: string, dest: string, callback: (err: string | null) => void): void;

/*
 * Reads the contents of a directory synchronously and returns an array of file and subdirectory names.
 * @param path The path to the directory to read.
 */
export function readdirSync(path: string): string[];
/*
 * Reads the contents of a directory asynchronously.
 * @param path The path to the directory to read.
 * @param callback Invoked with an error string (or null on success) and an array of entry names.
 */
export function readdir(path: string, callback: (err: string | null, names?: string[]) => void): void;

/*
 * Creates a new directory synchronously.
 * @param path The path of the directory to create.
 */
export function mkdirSync(path: string): void;
/*
 * Creates a new directory asynchronously.
 * @param path The path of the directory to create.
 * @param callback Invoked with an error string (or null on success) upon completion.
 */
export function mkdir(path: string, callback: (err: string | null) => void): void;

/*
 * Removes an empty directory synchronously.
 * @param path The path of the directory to remove.
 */
export function rmdirSync(path: string): void;
/*
 * Removes an empty directory asynchronously.
 * @param path The path of the directory to remove.
 * @param callback Invoked with an error string (or null on success) upon completion.
 */
export function rmdir(path: string, callback: (err: string | null) => void): void;
