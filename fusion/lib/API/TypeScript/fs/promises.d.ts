// Copyright (C) 2025 Autodesk Inc.
// All rights reserved.

/*
 * Promise-based file system module.
 * Each function returns a Promise that resolves on success or rejects with an error.
 * All paths are relative to the restricted script working directory.
 * Promise resolutions run when the main thread processes idle tasks (via adsk.doEvents).
 */

/*
 * Reads the entire contents of a file and resolves with a Uint8Array of raw bytes.
 * @param path The path to the file to read.
 */
export function readFile(path: string): Promise<Uint8Array>;
/*
 * Reads the entire contents of a file with the specified encoding.
 * When encoding is "utf8", resolves with a string.
 * @param path The path to the file to read.
 * @param encoding The character encoding to use (e.g. "utf8").
 */
export function readFile(path: string, encoding: string): Promise<string | Uint8Array>;

/*
 * Writes data to a file, replacing the file if it already exists.
 * @param path The path to the file to write.
 * @param data The content to write, as a string or Uint8Array.
 */
export function writeFile(path: string, data: string | Uint8Array): Promise<void>;

/*
 * Appends the given string data to a file. Creates the file if it does not exist.
 * @param path The path to the file to append to.
 * @param data The string content to append.
 */
export function appendFile(path: string, data: string): Promise<void>;

/*
 * Deletes a file.
 * @param path The path to the file to delete.
 */
export function unlink(path: string): Promise<void>;

/*
 * Renames or moves a file or directory.
 * @param oldPath The current path of the file or directory.
 * @param newPath The new path for the file or directory.
 */
export function rename(oldPath: string, newPath: string): Promise<void>;

/*
 * Copies a file. Overwrites the destination if it already exists.
 * @param src The path to the source file.
 * @param dest The path to the destination file.
 */
export function copyFile(src: string, dest: string): Promise<void>;

/*
 * Reads the contents of a directory and resolves with an array of file and subdirectory names.
 * @param path The path to the directory to read.
 */
export function readdir(path: string): Promise<string[]>;

/*
 * Creates a new directory.
 * @param path The path of the directory to create.
 */
export function mkdir(path: string): Promise<void>;

/*
 * Removes an empty directory.
 * @param path The path of the directory to remove.
 */
export function rmdir(path: string): Promise<void>;
